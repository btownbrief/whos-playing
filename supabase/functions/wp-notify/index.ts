// wp-notify — OPTIONAL. Emails a poster when someone replies to their call.
// Without this function (or without RESEND_API_KEY), nothing breaks: replies
// simply wait under "Mine", which is the documented baseline.
//
// Deploy (once, from the repo root, with the Supabase CLI logged in):
//   supabase functions deploy wp-notify --project-ref jnouvwxomrcffqwilqkq
//   supabase secrets set RESEND_API_KEY=re_xxx NOTIFY_FROM="Who's Playing <hello@btownbrief.com>"
// The function runs with the service role (default for edge functions) so
// it can read the private email + contact columns the public RPCs never
// expose. It sends at most one email per reply (the `notified` flag), so a
// client spamming this endpoint with the same reply_id does nothing.

import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = 'https://play.btownbrief.com/whos-playing/';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { reply_id } = await req.json().catch(() => ({}));
    if (typeof reply_id !== 'string' || !/^[0-9a-f-]{36}$/.test(reply_id)) return ok({ sent: false, why: 'bad_id' });
    const key = Deno.env.get('RESEND_API_KEY');
    if (!key) return ok({ sent: false, why: 'no_key' });

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // claim the reply atomically: only the first caller flips notified
    const { data: claimed } = await db.from('wp_replies')
      .update({ notified: true }).eq('id', reply_id).eq('notified', false)
      .select('id, post_id, name, note').maybeSingle();
    if (!claimed) return ok({ sent: false, why: 'already' });
    const { data: post } = await db.from('wp_posts').select('name, sport, email, status').eq('id', claimed.post_id).maybeSingle();
    if (!post || post.status !== 'open' || !post.email) return ok({ sent: false, why: 'no_email' });

    const from = Deno.env.get('NOTIFY_FROM') || "Who's Playing <onboarding@resend.dev>";
    const text = [
      `Hi ${post.name},`,
      '',
      `${claimed.name} replied to your ${post.sport} call on Who's Playing:`,
      '',
      `  "${claimed.note}"`,
      '',
      `Their contact details are under Mine, on the phone you posted from: ${APP_URL}`,
      '',
      "Meet somewhere public the first time, and if you've found someone, close the call so others stop replying.",
      '',
      '— Btown Brief',
    ].join('\n');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [post.email], subject: `${claimed.name} replied to your ${post.sport} call`, text }),
    });
    if (!res.ok) {
      // give it back so a later call can retry
      await db.from('wp_replies').update({ notified: false }).eq('id', reply_id);
      return ok({ sent: false, why: `resend_${res.status}` });
    }
    return ok({ sent: true });
  } catch (e) {
    return ok({ sent: false, why: 'error' });
  }
});
