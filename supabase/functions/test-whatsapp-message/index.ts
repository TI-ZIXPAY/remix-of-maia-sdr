import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🧪 Test WhatsApp Message function invoked');

    const body = await req.json();
    const phone_number = body.phone_number || body.phone;
    const message = body.message;
    const instanceId = body.instance_id || null;

    if (!phone_number || !message) {
      console.error('❌ Missing required fields');
      return new Response(
        JSON.stringify({ success: false, error: 'Número de telefone e mensagem são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanPhone = phone_number.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return new Response(
        JSON.stringify({ success: false, error: 'Formato de número inválido. Use o formato internacional (ex: 5511999999999)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('📱 Testing message to:', cleanPhone);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuário não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch settings (for provider detection and Cloud API credentials)
    console.log('🔍 Fetching WhatsApp credentials for user:', userId);
    let settings: any = null;

    const { data: userSettings } = await supabase
      .from('nina_settings')
      .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_provider, uazapi_endpoint, uazapi_session, uazapi_sessionkey')
      .eq('user_id', userId)
      .maybeSingle();
    settings = userSettings;

    if (!settings) {
      const { data: globalSettings } = await supabase
        .from('nina_settings')
        .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_provider, uazapi_endpoint, uazapi_session, uazapi_sessionkey')
        .is('user_id', null)
        .maybeSingle();
      settings = globalSettings;
    }

    if (!settings) {
      const { data: anySettings } = await supabase
        .from('nina_settings')
        .select('whatsapp_access_token, whatsapp_phone_number_id, whatsapp_provider, uazapi_endpoint, uazapi_session, uazapi_sessionkey')
        .limit(1)
        .maybeSingle();
      settings = anySettings;
    }

    if (!settings) {
      return new Response(
        JSON.stringify({ success: false, error: 'Sistema não configurado. Acesse /settings para configurar o sistema primeiro.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isUazapi = settings.whatsapp_provider === 'uazapi';
    console.log('🔍 WhatsApp provider:', isUazapi ? 'uazapi' : 'cloud');

    // Resolve Uazapi credentials: instance → contact instance → nina_settings fallback
    let uazapiEndpoint = settings.uazapi_endpoint || '';
    let uazapiSessionkey = settings.uazapi_sessionkey || '';

    if (isUazapi) {
      // If a specific instance_id was provided (e.g. from UI), use it
      if (instanceId) {
        const { data: inst } = await supabase
          .from('uazapi_instances')
          .select('endpoint, sessionkey')
          .eq('id', instanceId)
          .eq('is_active', true)
          .maybeSingle();
        if (inst) {
          uazapiEndpoint = inst.endpoint;
          uazapiSessionkey = inst.sessionkey;
        }
      }

      // If still no creds, try contact's instance
      if (!uazapiEndpoint || !uazapiSessionkey) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('uazapi_instance_id')
          .eq('phone_number', cleanPhone)
          .maybeSingle();

        if (contact?.uazapi_instance_id) {
          const { data: inst } = await supabase
            .from('uazapi_instances')
            .select('endpoint, sessionkey')
            .eq('id', contact.uazapi_instance_id)
            .eq('is_active', true)
            .maybeSingle();
          if (inst) {
            uazapiEndpoint = inst.endpoint;
            uazapiSessionkey = inst.sessionkey;
          }
        }
      }

      // If still no creds, try first active instance
      if (!uazapiEndpoint || !uazapiSessionkey) {
        const { data: firstInst } = await supabase
          .from('uazapi_instances')
          .select('endpoint, sessionkey')
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstInst) {
          uazapiEndpoint = firstInst.endpoint;
          uazapiSessionkey = firstInst.sessionkey;
        }
      }

      if (!uazapiEndpoint || !uazapiSessionkey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Uazapi não está configurado. Adicione uma instância nas configurações.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      if (!settings.whatsapp_access_token || !settings.whatsapp_phone_number_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'WhatsApp Cloud não está configurado. Configure as credenciais primeiro.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get or create contact
    const { data: existingContact } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone_number', cleanPhone)
      .maybeSingle();

    let contactId: string;

    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const { data: newContact, error: contactError } = await supabase
        .from('contacts')
        .insert({
          phone_number: cleanPhone,
          whatsapp_id: cleanPhone,
          user_id: null,
        })
        .select()
        .single();

      if (contactError) {
        return new Response(
          JSON.stringify({ success: false, error: 'Erro ao criar contato: ' + contactError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      contactId = newContact.id;
    }

    // Get or create conversation
    const { data: existingConversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('contact_id', contactId)
      .eq('is_active', true)
      .maybeSingle();

    let conversationId: string;

    if (existingConversation) {
      conversationId = existingConversation.id;
    } else {
      const { data: newConversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          contact_id: contactId,
          status: 'nina',
          is_active: true,
          user_id: null,
        })
        .select()
        .single();

      if (convError) {
        return new Response(
          JSON.stringify({ success: false, error: 'Erro ao criar conversa: ' + convError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      conversationId = newConversation.id;
    }

    // Create message record
    const { data: newMessage, error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        from_type: 'nina',
        type: 'text',
        content: message,
        status: 'processing',
      })
      .select()
      .single();

    if (messageError) {
      return new Response(
        JSON.stringify({ success: false, error: 'Erro ao criar mensagem: ' + messageError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send message
    let whatsappMessageId: string | undefined;
    
    if (isUazapi) {
      const endpoint = uazapiEndpoint.replace(/\/+$/, '');
      const uazapiUrl = `${endpoint}/send/text`;
      console.log('📤 Sending test message via Uazapi to:', cleanPhone);
      
      const uazapiResponse = await fetch(uazapiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'token': uazapiSessionkey,
        },
        body: JSON.stringify({
          number: cleanPhone,
          text: message
        })
      });

      const uazapiData = await uazapiResponse.json();

      if (!uazapiResponse.ok || uazapiData.error) {
        console.error('❌ Uazapi API error:', uazapiData);
        await supabase.from('messages').update({ status: 'failed' }).eq('id', newMessage.id);
        return new Response(
          JSON.stringify({ success: false, error: uazapiData.error || uazapiData.message || 'Erro ao enviar mensagem via Uazapi', details: uazapiData }),
          { status: uazapiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('✅ Uazapi message sent successfully:', uazapiData);
      whatsappMessageId = uazapiData.key?.id || uazapiData.messageId || uazapiData.id;
      
    } else {
      const whatsappUrl = `https://graph.facebook.com/v17.0/${settings.whatsapp_phone_number_id}/messages`;
      
      const whatsappResponse = await fetch(whatsappUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.whatsapp_access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: { body: message }
        })
      });

      const whatsappData = await whatsappResponse.json();

      if (!whatsappResponse.ok) {
        await supabase.from('messages').update({ status: 'failed' }).eq('id', newMessage.id);
        return new Response(
          JSON.stringify({ success: false, error: whatsappData.error?.message || 'Erro ao enviar mensagem via WhatsApp', details: whatsappData }),
          { status: whatsappResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      whatsappMessageId = whatsappData.messages?.[0]?.id;
    }

    // Update message with whatsapp_message_id
    await supabase
      .from('messages')
      .update({ whatsapp_message_id: whatsappMessageId, status: 'sent' })
      .eq('id', newMessage.id);

    // Update conversation last_message_at
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message_id: whatsappMessageId,
        contact_id: contactId,
        conversation_id: conversationId,
        provider: isUazapi ? 'uazapi' : 'cloud'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erro inesperado' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
