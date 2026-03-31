import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { contactIds } = await req.json();

    if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "contactIds array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit batch size
    const ids = contactIds.slice(0, 20);

    // Get contacts that need profile picture updates
    const { data: contacts, error: contactsError } = await supabase
      .from("contacts")
      .select("id, phone_number, whatsapp_id, profile_picture_url, updated_at")
      .in("id", ids);

    if (contactsError || !contacts) {
      console.error("[ProfilePic] Error fetching contacts:", contactsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch contacts" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter contacts that need update (no picture, or picture older than 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const needsUpdate = contacts.filter((c) => {
      // Skip if already has a picture and was updated recently
      if (c.profile_picture_url && c.updated_at > sevenDaysAgo) {
        return false;
      }
      return true;
    });

    if (needsUpdate.length === 0) {
      // Return existing URLs
      const results: Record<string, string | null> = {};
      contacts.forEach((c) => {
        results[c.id] = c.profile_picture_url;
      });
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get provider setting
    const { data: settings } = await supabase
      .from("nina_settings")
      .select("uazapi_endpoint, uazapi_session, uazapi_sessionkey, whatsapp_provider")
      .limit(1)
      .maybeSingle();

    if (settings?.whatsapp_provider !== "uazapi") {
      // Return existing URLs without fetching
      const results: Record<string, string | null> = {};
      contacts.forEach((c) => {
        results[c.id] = c.profile_picture_url;
      });
      return new Response(JSON.stringify({ success: true, results, warning: "UAZAPI not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper to resolve credentials for a contact
    async function resolveCredsForContact(contactId: string): Promise<{ endpoint: string; sessionkey: string } | null> {
      // 1. Try contact's instance
      const { data: contact } = await supabase
        .from("contacts")
        .select("uazapi_instance_id")
        .eq("id", contactId)
        .maybeSingle();

      if (contact?.uazapi_instance_id) {
        const { data: inst } = await supabase
          .from("uazapi_instances")
          .select("endpoint, session, sessionkey")
          .eq("id", contact.uazapi_instance_id)
          .eq("is_active", true)
          .maybeSingle();
        if (inst) {
          const ep = inst.endpoint.replace(/\/+$/, "");
          return { endpoint: inst.session ? `${ep}/${inst.session}` : ep, sessionkey: inst.sessionkey };
        }
      }

      // 2. Try first active instance
      const { data: firstInst } = await supabase
        .from("uazapi_instances")
        .select("endpoint, session, sessionkey")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstInst) {
        const ep = firstInst.endpoint.replace(/\/+$/, "");
        return { endpoint: firstInst.session ? `${ep}/${firstInst.session}` : ep, sessionkey: firstInst.sessionkey };
      }

      // 3. Fallback to nina_settings
      if (settings?.uazapi_endpoint && settings?.uazapi_sessionkey) {
        const ep = settings.uazapi_endpoint.replace(/\/+$/, "");
        const session = settings.uazapi_session || "";
        return { endpoint: session ? `${ep}/${session}` : ep, sessionkey: settings.uazapi_sessionkey };
      }

      return null;
    }

    const results: Record<string, string | null> = {};

    // Process each contact sequentially (to avoid rate limiting)
    for (const contact of needsUpdate) {
      try {
        const creds = await resolveCredsForContact(contact.id);
        if (!creds) {
          results[contact.id] = contact.profile_picture_url;
          continue;
        }

        const jid = contact.whatsapp_id || `${contact.phone_number.replace(/\D/g, "")}@s.whatsapp.net`;

        console.log(`[ProfilePic] Fetching picture for ${jid}`);

        const response = await fetch(`${creds.endpoint}/contact/getProfilePicture`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            sessionkey: creds.sessionkey,
          },
          body: JSON.stringify({ id: jid }),
        });

        const data = await response.json();
        console.log(`[ProfilePic] Response for ${contact.id}:`, JSON.stringify(data).substring(0, 200));

        let pictureUrl: string | null = null;

        if (typeof data === "string" && data.startsWith("http")) {
          pictureUrl = data;
        } else if (data?.URL) {
          pictureUrl = data.URL;
        } else if (data?.url) {
          pictureUrl = data.url;
        } else if (data?.profilePicUrl) {
          pictureUrl = data.profilePicUrl;
        } else if (data?.imgUrl) {
          pictureUrl = data.imgUrl;
        } else if (data?.profilePictureUrl) {
          pictureUrl = data.profilePictureUrl;
        } else if (data?.picture) {
          pictureUrl = data.picture;
        } else if (data?.eurl) {
          pictureUrl = data.eurl;
        }

        if (pictureUrl) {
          await supabase
            .from("contacts")
            .update({ profile_picture_url: pictureUrl, updated_at: new Date().toISOString() })
            .eq("id", contact.id);
          results[contact.id] = pictureUrl;
        } else {
          await supabase
            .from("contacts")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", contact.id);
          results[contact.id] = contact.profile_picture_url;
        }
      } catch (err) {
        console.error(`[ProfilePic] Error for contact ${contact.id}:`, err);
        results[contact.id] = contact.profile_picture_url;
      }

      if (needsUpdate.indexOf(contact) < needsUpdate.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Include contacts that didn't need update
    contacts.forEach((c) => {
      if (!(c.id in results)) {
        results[c.id] = c.profile_picture_url;
      }
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[ProfilePic] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
