import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Normalize Brazilian phone: always add 9th digit (55+DDD+9+8digits = 13 digits) */
function normalizeBrazilianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("55")) {
    return "55" + digits.slice(2, 4) + "9" + digits.slice(4);
  }
  return digits;
}

/** Get both variants of a BR phone (with and without 9) */
function getBrazilianPhoneVariants(phone: string): string[] {
  const canonical = normalizeBrazilianPhone(phone);
  const variants = [canonical];
  if (canonical.length === 13 && canonical.startsWith("55")) {
    variants.push("55" + canonical.slice(2, 4) + canonical.slice(5));
  }
  return variants;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Accept API key via header or query param
    const url = new URL(req.url);
    const apiKeyHeader = req.headers.get("x-api-key");
    const apiKeyParam = url.searchParams.get("api_key");
    const providedKey = apiKeyHeader || apiKeyParam;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check API key against env secret OR database-stored key
    const expectedKeyEnv = Deno.env.get("WEBHOOK_SIGNING_SECRET");
    let authorized = providedKey && expectedKeyEnv && providedKey === expectedKeyEnv;

    if (!authorized) {
      // Fallback: check against webhook_api_key stored in nina_settings
      const { data: settings } = await supabase
        .from("nina_settings")
        .select("webhook_api_key")
        .limit(1)
        .maybeSingle();
      const dbKey = settings?.webhook_api_key;
      authorized = !!(providedKey && dbKey && providedKey === dbKey);
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("[create-deal-webhook] Payload received:", JSON.stringify(body));

    // Required fields
    const phone = body.phone || body.telefone || body.phone_number;
    if (!phone) {
      return new Response(
        JSON.stringify({ error: "Campo 'phone' é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize phone (canonical Brazilian format with 9th digit)
    const normalizedPhone = normalizeBrazilianPhone(phone);

    // Optional contact fields
    const name = body.name || body.nome || null;
    const email = body.email || null;
    const tags = body.tags || [];
    const notes = body.notes || body.observacoes || null;

    // Optional deal fields
    const dealTitle = body.deal_title || body.titulo || name || normalizedPhone;
    const dealValue = body.deal_value || body.valor || 0;
    const dealPriority = body.priority || body.prioridade || "medium";
    const dealCompany = body.company || body.empresa || null;
    const dealStageId = body.stage_id || null;
    const updateExisting = body.update_existing !== false; // default true
    const customFields: Record<string, string> = body.custom_fields || {};

    // Optional appointment fields
    const appointmentDate = body.appointment_date || body.data_reuniao || null; // YYYY-MM-DD
    const appointmentTime = body.appointment_time || body.hora_reuniao || null; // HH:mm:ss
    const appointmentTitle = body.appointment_title || body.titulo_reuniao || null;
    const appointmentDuration = body.appointment_duration || body.duracao_reuniao || 60;
    const appointmentType = body.appointment_type || body.tipo_reuniao || "meeting";
    const appointmentMeetingUrl = body.meeting_url || body.url_reuniao || null;
    const appointmentDescription = body.appointment_description || body.descricao_reuniao || null;
    const appointmentAttendees = body.appointment_attendees || body.participantes || [];

    // UTM fields
    const utmSource = body.utm_source || null;
    const utmMedium = body.utm_medium || null;
    const utmCampaign = body.utm_campaign || null;
    const utmContent = body.utm_content || null;
    const utmTerm = body.utm_term || null;

    // 1. Find or create contact by phone (with Brazilian 9th digit fallback)
    let contactId: string;
    let existingContact = false;

    // Build contact data
    const contactData: Record<string, unknown> = {
      phone_number: normalizedPhone,
      last_activity: new Date().toISOString(),
    };
    if (name) contactData.name = name;
    if (email) contactData.email = email;
    if (tags.length > 0) contactData.tags = tags;
    if (notes) contactData.notes = notes;
    if (utmSource) contactData.utm_source = utmSource;
    if (utmMedium) contactData.utm_medium = utmMedium;
    if (utmCampaign) contactData.utm_campaign = utmCampaign;
    if (utmContent) contactData.utm_content = utmContent;
    if (utmTerm) contactData.utm_term = utmTerm;

    // Try to find existing contact using both phone variants (with/without 9)
    const phoneVariants = getBrazilianPhoneVariants(normalizedPhone);
    const { data: existingContactRow } = await supabase
      .from("contacts")
      .select("id, created_at, phone_number")
      .in("phone_number", phoneVariants)
      .maybeSingle();

    let upsertedContact: { id: string; created_at: string } | null = null;

    if (existingContactRow) {
      // Update existing contact (also normalize phone to canonical)
      const { error: updateError } = await supabase
        .from("contacts")
        .update(contactData)
        .eq("id", existingContactRow.id);
      if (updateError) {
        console.error("[create-deal-webhook] Contact update error:", updateError);
      }
      upsertedContact = { id: existingContactRow.id, created_at: existingContactRow.created_at };
    } else {
      // Create new contact with canonical phone
      const { data: newContact, error: insertError } = await supabase
        .from("contacts")
        .insert(contactData)
        .select("id, created_at")
        .single();
      if (insertError) {
        console.error("[create-deal-webhook] Contact insert error:", insertError);
        return new Response(
          JSON.stringify({ error: "Erro ao criar contato", details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      upsertedContact = newContact;
    }

    if (!upsertedContact) {
      return new Response(
        JSON.stringify({ error: "Erro ao criar/atualizar contato" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    contactId = upsertedContact.id;
    // If created_at is very recent (within 2 seconds), it's a new contact
    const contactAge = Date.now() - new Date(upsertedContact.created_at).getTime();
    existingContact = contactAge > 2000;
    console.log(`[create-deal-webhook] Contact upserted: ${contactId} (existing: ${existingContact})`);

    // 2. Resolve pipeline stage
    let stageId = dealStageId;
    if (!stageId) {
      const { data: firstStage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("is_active", true)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      stageId = firstStage?.id;
    }
    if (!stageId) {
      return new Response(
        JSON.stringify({ error: "Nenhum estágio de pipeline encontrado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Create or update deal
    let dealId: string;
    let dealAction: "created" | "updated" = "created";

    const { data: existingDeal } = await supabase
      .from("deals")
      .select("id")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDeal && !existingContact) {
      // Deal was auto-created by trigger for new contact, update it
      dealId = existingDeal.id;
      dealAction = "updated";
      await supabase.from("deals").update({
        title: dealTitle,
        value: dealValue,
        priority: dealPriority,
        company: dealCompany,
        stage_id: stageId,
        tags,
      }).eq("id", dealId);
      console.log("[create-deal-webhook] Deal updated (auto-created):", dealId);
    } else if (existingDeal && existingContact && updateExisting) {
      // Update existing deal with new info
      dealId = existingDeal.id;
      dealAction = "updated";
      const updateData: Record<string, unknown> = {
        title: dealTitle,
        value: dealValue,
        priority: dealPriority,
        company: dealCompany,
        tags,
      };
      // Only update stage if explicitly provided
      if (dealStageId) updateData.stage_id = stageId;
      await supabase.from("deals").update(updateData).eq("id", dealId);
      console.log("[create-deal-webhook] Deal updated (existing contact):", dealId);
    } else {
      // Create new deal (no existing deal, or update_existing=false)
      const { data: newDeal, error: dealError } = await supabase
        .from("deals")
        .insert({
          title: dealTitle,
          contact_id: contactId,
          stage_id: stageId,
          value: dealValue,
          priority: dealPriority,
          company: dealCompany,
          tags,
        })
        .select("id")
        .single();

      if (dealError) {
        console.error("[create-deal-webhook] Deal creation error:", dealError);
        return new Response(
          JSON.stringify({ error: "Erro ao criar deal", details: dealError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      dealId = newDeal.id;
      console.log("[create-deal-webhook] Deal created:", dealId);
    }

    // 4. Save custom field values
    if (Object.keys(customFields).length > 0) {
      const { data: fieldDefs } = await supabase
        .from("contact_custom_fields")
        .select("id, field_key")
        .eq("is_active", true);

      if (fieldDefs && fieldDefs.length > 0) {
        const keyToId: Record<string, string> = {};
        fieldDefs.forEach((f) => {
          keyToId[f.field_key] = f.id;
        });

        const upserts = Object.entries(customFields)
          .filter(([key]) => keyToId[key])
          .map(([key, value]) => ({
            contact_id: contactId,
            field_id: keyToId[key],
            value: String(value),
          }));

        if (upserts.length > 0) {
          const { error: cfError } = await supabase
            .from("contact_custom_field_values")
            .upsert(upserts, { onConflict: "contact_id,field_id" });

          if (cfError) {
            console.error("[create-deal-webhook] Custom fields error:", cfError);
          } else {
            console.log("[create-deal-webhook] Custom fields saved:", upserts.length);
          }
        }
      }
    }

    // 5. Create or update appointment if date/time provided
    let appointmentId: string | null = null;
    if (appointmentDate && appointmentTime) {
      const apptData: Record<string, unknown> = {
        contact_id: contactId,
        date: appointmentDate,
        time: appointmentTime,
        title: appointmentTitle || `Reunião - ${dealTitle}`,
        duration: appointmentDuration,
        type: appointmentType,
        meeting_url: appointmentMeetingUrl,
        description: appointmentDescription,
        attendees: appointmentAttendees,
        status: "scheduled",
      };

      // Check if contact already has an active appointment
      const { data: existingAppt } = await supabase
        .from("appointments")
        .select("id")
        .eq("contact_id", contactId)
        .in("status", ["scheduled", "confirmed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingAppt) {
        // Update existing appointment
        const { error: apptUpdateError } = await supabase
          .from("appointments")
          .update(apptData)
          .eq("id", existingAppt.id);
        if (apptUpdateError) {
          console.error("[create-deal-webhook] Appointment update error:", apptUpdateError);
        } else {
          appointmentId = existingAppt.id;
          console.log("[create-deal-webhook] Appointment updated:", appointmentId);
        }
      } else {
        // Create new appointment
        const { data: newAppt, error: apptError } = await supabase
          .from("appointments")
          .insert(apptData)
          .select("id")
          .single();
        if (apptError) {
          console.error("[create-deal-webhook] Appointment creation error:", apptError);
        } else {
          appointmentId = newAppt.id;
          console.log("[create-deal-webhook] Appointment created:", appointmentId);
        }
      }

      if (appointmentId) {
        // Auto-move deal to "Fechamento" stage
        const { data: fechamentoStage } = await supabase
          .from("pipeline_stages")
          .select("id")
          .eq("is_active", true)
          .ilike("title", "%fechamento%")
          .limit(1)
          .maybeSingle();

        if (fechamentoStage) {
          await supabase.from("deals").update({ stage_id: fechamentoStage.id }).eq("id", dealId);
          console.log("[create-deal-webhook] Deal moved to Fechamento stage");
        }

        // Update contact follow_up_status
        await supabase.from("contacts").update({ follow_up_status: "agendado" }).eq("id", contactId);
      }
    }

    // 6. Recalculate lead score via dedicated function
    let scoreResult: any = { totalScore: 0, classification: "new", breakdown: {} };
    try {
      const scoreResp = await fetch(`${supabaseUrl}/functions/v1/recalculate-lead-score`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ contact_id: contactId }),
      });
      if (scoreResp.ok) {
        scoreResult = await scoreResp.json();
        console.log(`[create-deal-webhook] Lead score recalculated:`, scoreResult);
      } else {
        console.error("[create-deal-webhook] Score recalc failed:", await scoreResp.text());
      }
    } catch (e) {
      console.error("[create-deal-webhook] Score recalc error:", e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action: dealAction,
        contact_id: contactId,
        deal_id: dealId,
        appointment_id: appointmentId,
        lead_score: scoreResult.totalScore || 0,
        lead_classification: scoreResult.classification || "new",
        score_breakdown: scoreResult.breakdown || {},
        message: dealAction === "updated" ? "Deal atualizado com sucesso" : "Deal criado com sucesso",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[create-deal-webhook] Error:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
