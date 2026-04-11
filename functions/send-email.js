// functions/send-email.js
// Cloudflare Pages Function — proxies Resend API server-side
// Resend blocks browser calls (CORS) — this function solves that
// Export: onRequestPost (Cloudflare syntax)

export async function onRequestPost(context) {
  const { request, env } = context;

  const RESEND_KEY   = env.RESEND_API_KEY;
  const FROM_EMAIL   = env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const OWNER_EMAIL  = "jobhauntgithub@gmail.com";

  if (!RESEND_KEY) {
    return Response.json({ error: "RESEND_API_KEY not set in Cloudflare environment variables." }, { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { lead, pdfBase64 } = body;
  if (!lead?.email || !lead?.name) {
    return Response.json({ error: "lead.email and lead.name are required." }, { status: 400 });
  }

  const annualLost   = Math.round((lead.reviews < 5 ? 20 : 10) * 150) * 12;
  const pdfFilename  = `${lead.name.replace(/[^a-z0-9]/gi, "_")}_Growth_Audit.pdf`;
  const attachments  = pdfBase64 ? [{ filename: pdfFilename, content: pdfBase64 }] : [];

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f0f2f8;font-family:'Helvetica Neue',Arial,sans-serif}
  .wrap{max-width:600px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)}
  .hdr{background:linear-gradient(135deg,#1a1a2e,#0f3460);padding:40px;text-align:center}
  .hdr h1{color:#fff;margin:0;font-size:22px;letter-spacing:1px}
  .hdr p{color:#a0b4d0;margin:8px 0 0;font-size:13px}
  .bdy{padding:36px 40px;color:#333}
  .bdy p{line-height:1.75;font-size:15px;margin:0 0 16px}
  .box{background:#fff8f0;border-left:4px solid #e94560;padding:18px 22px;border-radius:6px;margin:22px 0}
  .box strong{color:#e94560}
  .cta{display:block;width:fit-content;margin:28px auto;background:linear-gradient(135deg,#e94560,#f5a623);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:15px 38px;border-radius:6px;text-align:center}
  .ftr{background:#1a1a2e;padding:22px 40px;text-align:center;color:#5a7090;font-size:12px}
  .ftr a{color:#a0b4d0}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Ace Digitals Global</h1>
    <p>Your Free Digital Growth Audit Is Ready</p>
  </div>
  <div class="bdy">
    <p>Hi <strong>${lead.name}</strong> team,</p>
    <p>I put together a <strong>free digital audit</strong> specifically for <strong>${lead.name}</strong> — no strings attached.</p>
    <p>Here is the short version of what I found:</p>
    <div class="box">
      <strong>Audit Snapshot</strong><br><br>
      No website — you are invisible to 97% of customers who search online first<br><br>
      ${lead.reviews} Google review${lead.reviews !== 1 ? "s" : ""} — below the trust threshold<br><br>
      Estimated revenue impact: <strong>$${annualLost.toLocaleString()}+/year</strong>
    </div>
    <p>The attached 8-page report covers what your competitors are doing, how much revenue this is costing you, and a clear 30-day plan to fix it.</p>
    <p>No pitch, no pressure — just data and a clear path forward.</p>
    <a href="mailto:jobhauntgithub@gmail.com?subject=Re: Growth Audit for ${encodeURIComponent(lead.name)}" class="cta">Reply to Book a Free 20-Min Call</a>
    <p style="font-size:13px;color:#888;text-align:center">Or call: +1 873 352 2008</p>
  </div>
  <div class="ftr">
    <p><strong style="color:#fff">Ace Digitals Global</strong> &nbsp;|&nbsp; jobhauntgithub@gmail.com &nbsp;|&nbsp; +1 873 352 2008 &nbsp;|&nbsp; acedigitalsempire.com</p>
    <p style="margin-top:8px"><a href="mailto:jobhauntgithub@gmail.com?subject=Unsubscribe">Unsubscribe</a></p>
  </div>
</div>
</body>
</html>`;

  try {
    // Send to lead
    const clientRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Ace Digitals Global <${FROM_EMAIL}>`,
        to: [lead.email],
        subject: `Free Growth Audit for ${lead.name}`,
        html: htmlBody,
        ...(attachments.length ? { attachments } : {}),
      }),
    });

    const clientData = await clientRes.json();
    if (!clientRes.ok) throw new Error(clientData.message || "Resend rejected the email.");

    // Send owner copy
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `Ace Digitals Global <${FROM_EMAIL}>`,
        to: [OWNER_EMAIL],
        subject: `[COPY] Report sent to ${lead.name} — ${lead.email}`,
        html: `<div style="font-family:Arial,sans-serif;padding:20px">
          <h2>Owner Copy — Report Delivered</h2>
          <p><b>Business:</b> ${lead.name}</p>
          <p><b>Sent to:</b> ${lead.email}</p>
          <p><b>Score:</b> ${lead.score}/35</p>
          <p><b>Date:</b> ${new Date().toLocaleString()}</p>
        </div>`,
        ...(attachments.length ? { attachments } : {}),
      }),
    });

    return Response.json({ success: true, id: clientData.id });

  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
