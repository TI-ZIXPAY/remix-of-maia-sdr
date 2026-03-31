import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Normalization map: convert slug formats to display formats for consistent scoring
const NORMALIZATION_MAP: Record<string, Record<string, string>> = {
  faturamento: {
    "10-a-25k": "De 10 a 25 mil",
    "25-a-50k": "De 25 a 50 mil",
    "50-a-100k": "De 50 a 100 mil",
    "5-a-10k": "De 5 a 10 mil",
    "ate-5k": "Até 5 mil",
    "acima-200k": "+ de 100 mil",
    "acima-100k": "+ de 100 mil",
    "nao-fatura": "Não fatura",
  },
};

async function recalculateScore(supabase: any, contactId: string) {
  console.log("[recalculate-lead-score] Starting for contact:", contactId);

  // 1. Fetch active scoring variables
  const { data: scoringVars, error: svError } = await supabase
    .from("scoring_variables")
    .select("*")
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (svError || !scoringVars || scoringVars.length === 0) {
    console.log("[recalculate-lead-score] No active scoring variables found");
    return { totalScore: 0, classification: "new", breakdown: {} };
  }

  // 2. Fetch all custom field values for this contact (join with field definitions)
  const { data: fieldValues, error: fvError } = await supabase
    .from("contact_custom_field_values")
    .select("value, field_id, contact_custom_fields!inner(field_key)")
    .eq("contact_id", contactId);

  if (fvError) {
    console.error("[recalculate-lead-score] Error fetching field values:", fvError);
    return null;
  }

  // Build a map of field_key -> value
  const fieldMap: Record<string, string> = {};
  for (const fv of fieldValues || []) {
    const fieldKey = (fv as any).contact_custom_fields?.field_key;
    if (fieldKey && fv.value) {
      fieldMap[fieldKey] = fv.value;
    }
  }

  // Auto-inference: set tem_ecommerce = "sim" if url_do_e_commerce is filled
  if (!fieldMap["tem_ecommerce"] || fieldMap["tem_ecommerce"].trim() === "") {
    const urlEcommerce = fieldMap["url_do_e_commerce"] || "";
    const situacao = (fieldMap["situacao_da_empresa"] || "").toLowerCase();
    if (
      urlEcommerce.trim().length > 0 ||
      situacao.includes("ecommerce") ||
      situacao.includes("e_commerce") ||
      situacao.includes("e-commerce")
    ) {
      fieldMap["tem_ecommerce"] = "sim";
      console.log("[recalculate-lead-score] Auto-inferred tem_ecommerce = sim");
    }
  }

  // Apply normalization to field values
  for (const [fieldKey, slugMap] of Object.entries(NORMALIZATION_MAP)) {
    const raw = fieldMap[fieldKey];
    if (raw && slugMap[raw.toLowerCase()]) {
      const normalized = slugMap[raw.toLowerCase()];
      console.log(`[recalculate-lead-score] Normalized ${fieldKey}: "${raw}" → "${normalized}"`);
      fieldMap[fieldKey] = normalized;
    }
  }

  console.log("[recalculate-lead-score] Field map:", fieldMap);

  // 3. Evaluate each scoring variable
  let totalScore = 0;
  const breakdown: Record<string, { title: string; points: number; field_key: string | null; value: string | null }> = {};

  for (const sv of scoringVars) {
    if (!sv.field_key) continue;

    const actualValue = fieldMap[sv.field_key] || "";
    let matched = false;

    switch (sv.match_condition) {
      case "not_empty":
        matched = actualValue.trim().length > 0;
        break;
      case "equals":
        matched = actualValue.toLowerCase() === (sv.match_value || "").toLowerCase();
        break;
      case "contains":
        matched = actualValue.toLowerCase().includes((sv.match_value || "").toLowerCase());
        break;
      case "not_equals":
        matched = actualValue.toLowerCase() !== (sv.match_value || "").toLowerCase();
        break;
      default:
        matched = false;
    }

    if (matched) {
      totalScore += sv.score;
      breakdown[sv.id] = {
        title: sv.title,
        points: sv.score,
        field_key: sv.field_key,
        value: actualValue,
      };
      console.log(`[recalculate-lead-score] Match: "${sv.title}" +${sv.score}pts (${sv.field_key}=${actualValue})`);
    }
  }

  // 4. Determine classification
  let classification = "new";
  if (totalScore >= 90) classification = "sql";
  else if (totalScore >= 70) classification = "mql";
  else if (totalScore >= 40) classification = "pre_mql";
  else if (totalScore > 0) classification = "nutricao";

  // 5. Update contact
  const { error: updateError } = await supabase
    .from("contacts")
    .update({
      lead_score: totalScore,
      lead_classification: classification,
      lead_score_breakdown: breakdown,
      lead_score_updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (updateError) {
    console.error("[recalculate-lead-score] Error updating contact:", updateError);
    return null;
  }

  console.log("[recalculate-lead-score] Done:", { contactId, totalScore, classification, rules: Object.keys(breakdown).length });
  return { totalScore, classification, breakdown };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const contactId = body.contact_id;
    const batchAll = body.batch_all === true;

    if (batchAll) {
      // Batch recalculate all contacts that have custom field values
      const { data: contacts, error } = await supabase
        .from("contacts")
        .select("id")
        .order("created_at", { ascending: false });

      if (error) throw error;

      let processed = 0;
      let errors = 0;
      for (const c of contacts || []) {
        const result = await recalculateScore(supabase, c.id);
        if (result) processed++;
        else errors++;
      }

      return new Response(
        JSON.stringify({ success: true, processed, errors }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!contactId) {
      return new Response(
        JSON.stringify({ error: "contact_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await recalculateScore(supabase, contactId);

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[recalculate-lead-score] Error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
