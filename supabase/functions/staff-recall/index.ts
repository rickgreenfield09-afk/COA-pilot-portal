// COA Employee Portal — supabase/functions/staff-recall/index.ts
// Staff Recall broadcast: admin-only mass email (work + home address) with
// a per-recipient confirm-receipt link. Two entry points in one function:
//   POST { subject, message, recipientMode, locations?, employeeIds? }
//        -> sends a new broadcast. recipientMode is 'all' | 'region' |
//           'handpick'; locations (exact-match location strings) is used
//           for 'region', employeeIds for 'handpick'. The browser already
//           knows the exact recipient list (it renders a live preview of
//           it), so this just re-derives the same set server-side rather
//           than trusting a list of IDs/addresses sent from the client.
//   GET  ?token=<ack_token>                   -> marks that recipient's
//                                                receipt confirmed, returns
//                                                a plain HTML thank-you page
//
// Env vars used:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase for
//     every Edge Function, do not need to be set manually.
//   RESEND_API_KEY — set via `supabase secrets set RESEND_API_KEY=...`
//   RESEND_FROM    — verified sender, e.g. "COA Staff Recall <recall@yourdomain.com>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function escapeHtml(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function confirmPage(message: string) {
  return "<div style=\"font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;\">"
    + "<h1>" + message + "</h1>"
    + "<p>You can close this window.</p></div>";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---- Confirmation link ----
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return htmlResponse(confirmPage("Missing confirmation token."), 400);

    const { data: recipient, error } = await admin
      .from("staff_recall_recipients")
      .select("id, acknowledged_at")
      .eq("ack_token", token)
      .maybeSingle();

    if (error || !recipient) {
      return htmlResponse(confirmPage("This confirmation link is invalid or has expired."));
    }
    if (!recipient.acknowledged_at) {
      await admin
        .from("staff_recall_recipients")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("id", recipient.id);
    }
    return htmlResponse(confirmPage("Thanks &mdash; your receipt has been confirmed."));
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ---- Send broadcast ----
  const authHeader = req.headers.get("Authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return jsonResponse({ error: "Missing Authorization header" }, 401);

  // This app has no RLS yet, so this explicit role check is the only thing
  // standing between "logged in" and "can mass-email every employee's home
  // address" — it cannot be enforced client-side.
  const { data: userData, error: userErr } = await admin.auth.getUser(callerToken);
  if (userErr || !userData?.user) return jsonResponse({ error: "Invalid session" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!callerProfile || callerProfile.role !== "admin") {
    return jsonResponse({ error: "Admins only" }, 403);
  }

  let payload: {
    subject?: string;
    message?: string;
    recipientMode?: string;
    locations?: string[];
    employeeIds?: string[];
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const subject = (payload.subject || "").trim();
  const message = (payload.message || "").trim();
  const recipientMode = payload.recipientMode || "all";
  const locations = (payload.locations || []).map((l) => l.trim()).filter(Boolean);
  const employeeIds = (payload.employeeIds || []).filter(Boolean);

  if (!subject || !message) {
    return jsonResponse({ error: "Subject and message are required" }, 400);
  }
  if (!["all", "region", "handpick"].includes(recipientMode)) {
    return jsonResponse({ error: "Invalid recipientMode" }, 400);
  }
  if (recipientMode === "region" && !locations.length) {
    return jsonResponse({ error: "Select at least one region" }, 400);
  }
  if (recipientMode === "handpick" && !employeeIds.length) {
    return jsonResponse({ error: "Select at least one employee" }, 400);
  }

  let profileQuery = admin
    .from("profiles")
    .select("id, full_name, email, home_email, location");
  if (recipientMode === "region") {
    profileQuery = profileQuery.in("location", locations);
  } else if (recipientMode === "handpick") {
    profileQuery = profileQuery.in("id", employeeIds);
  }
  const { data: targets, error: targetsErr } = await profileQuery;
  if (targetsErr) return jsonResponse({ error: "Couldn't load recipients" }, 500);

  const recipients = (targets || []).filter((p) => p.email || p.home_email);
  if (!recipients.length) {
    return jsonResponse({ error: "No matching employees have an email on file" }, 400);
  }

  const filterSummary = recipientMode === "region" ? locations.join("; ") : null;

  const { data: broadcast, error: broadcastErr } = await admin
    .from("staff_recall_broadcasts")
    .insert({
      sent_by: userData.user.id,
      subject,
      message,
      recipient_mode: recipientMode,
      filter_summary: filterSummary,
      recipient_count: recipients.length
    })
    .select()
    .single();
  if (broadcastErr || !broadcast) return jsonResponse({ error: "Couldn't log broadcast" }, 500);

  const functionBaseUrl = SUPABASE_URL + "/functions/v1/staff-recall";
  let sentCount = 0;

  for (const person of recipients) {
    const { data: recipientRow, error: recipientErr } = await admin
      .from("staff_recall_recipients")
      .insert({
        broadcast_id: broadcast.id,
        employee_id: person.id,
        work_email: person.email || null,
        home_email: person.home_email || null
      })
      .select()
      .single();
    if (recipientErr || !recipientRow) continue;

    const toAddresses = [person.email, person.home_email].filter(Boolean) as string[];
    if (!toAddresses.length) continue;

    const confirmUrl = functionBaseUrl + "?token=" + recipientRow.ack_token;
    const emailHtml = "<div style=\"font-family:sans-serif;max-width:520px;\">"
      + "<h2>" + escapeHtml(subject) + "</h2>"
      + "<p style=\"white-space:pre-wrap;\">" + escapeHtml(message) + "</p>"
      + "<p><a href=\"" + confirmUrl + "\" style=\"display:inline-block;padding:10px 18px;background:#2AB8A6;color:#fff;text-decoration:none;border-radius:6px;\">I've received this message</a></p>"
      + "<p style=\"font-size:12px;color:#888;\">Sent by COA staff recall to " + escapeHtml(person.full_name || "employee") + ".</p>"
      + "</div>";

    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: toAddresses,
          subject: subject,
          html: emailHtml
        })
      });
      if (resendRes.ok) sentCount++;
    } catch (_e) {
      // Best-effort broadcast — one failed send shouldn't abort the rest.
    }
  }

  await admin
    .from("staff_recall_broadcasts")
    .update({ recipient_count: sentCount })
    .eq("id", broadcast.id);

  return jsonResponse({ broadcastId: broadcast.id, recipientCount: sentCount });
});
