

# Correção das Credenciais no Plano

O plano anterior usava as credenciais do projeto `stjjrzxumspxhxwfhdeo`. As credenciais corretas são:

## Credenciais Corrigidas

- **Project URL:** `https://feuxwdincoeecyjniwvm.supabase.co`
- **Project Ref:** `feuxwdincoeecyjniwvm`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZldXh3ZGluY29lZWN5am5pd3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTI1NDQsImV4cCI6MjA5MDU2ODU0NH0.xe3qmcyHqT8cCvQ0wQsS5Kj11ki3d2SkaFZnaNbAgvU`

## Plano Atualizado — MAIA SDR em Novo Projeto Lovable (sem Cloud)

### Passo 1 — Criar novo projeto Lovable SEM Cloud

1. Vá em **Settings → Connectors → Lovable Cloud → Disable Cloud**
2. Crie um **novo projeto vazio** no Lovable
3. Confirme que o novo projeto **não tem** Lovable Cloud ativo

### Passo 2 — Conectar seu Supabase externo

No novo projeto, vá em **Settings → Connectors → Supabase** e insira:

- **Project URL:** `https://feuxwdincoeecyjniwvm.supabase.co`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZldXh3ZGluY29lZWN5am5pd3ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTI1NDQsImV4cCI6MjA5MDU2ODU0NH0.xe3qmcyHqT8cCvQ0wQsS5Kj11ki3d2SkaFZnaNbAgvU`

### Passo 3 — Preparar o banco Supabase

No Supabase Dashboard (`https://supabase.com/dashboard/project/feuxwdincoeecyjniwvm`):

1. Execute as migrations SQL (tabelas, funções, triggers, enums, RLS policies)
2. Configure os secrets em Edge Functions → Secrets:
   - `LOVABLE_API_KEY`
   - `CALENDLY_API_TOKEN`
   - `WEBHOOK_SIGNING_SECRET`
   - `DISPATCH_CRON_BEARER`
3. Crie o storage bucket `audio-messages` (público)
4. Deploy as Edge Functions via Supabase CLI

### Passo 4 — Migrar o código

No novo projeto, peça para eu:
1. Copiar todo o frontend (componentes, hooks, services, types, pages)
2. Copiar todas as Edge Functions
3. Fornecer os scripts SQL completos para o banco limpo

### Importante

- Edge Functions precisam ser deployadas via **Supabase CLI** (`supabase functions deploy`)
- O `.env` será configurado automaticamente pelo conector
- O banco começará limpo — dados do Cloud atual não são migrados

### Próximo passo

Após criar o novo projeto e conectar o Supabase, volte e peça para **"reconstruir o MAIA SDR no novo projeto"**.

