module.exports = [
"[project]/.next-internal/server/app/api/agents/qualifier/route/actions.js [app-rsc] (server actions loader, ecmascript)", ((__turbopack_context__, module, exports) => {

}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[project]/lib/supabase/server.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/supabase/server.ts
__turbopack_context__.s([
    "supabaseServer",
    ()=>supabaseServer,
    "supabaseService",
    ()=>supabaseService
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$createServerClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@supabase/ssr/dist/module/createServerClient.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@supabase/supabase-js/dist/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/headers.js [app-route] (ecmascript)");
;
;
;
async function supabaseServer() {
    const cookieStore = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cookies"])();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$ssr$2f$dist$2f$module$2f$createServerClient$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["createServerClient"])(("TURBOPACK compile-time value", "https://zrehiuirumqbesaawqee.supabase.co"), ("TURBOPACK compile-time value", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyZWhpdWlydW1xYmVzYWF3cWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NDEwNDcsImV4cCI6MjEwMTMxNzA0N30.r1pZLeD2L6fjnYCQrnYSsMBB7gh7RxT0KkXcdYqWfpg"), {
        cookies: {
            getAll: ()=>cookieStore.getAll(),
            setAll: (list)=>{
                try {
                    list.forEach(({ name, value, options })=>cookieStore.set(name, value, options));
                } catch  {
                // Called from a Server Component; middleware refreshes instead.
                }
            }
        }
    });
}
function supabaseService() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$supabase$2f$supabase$2d$js$2f$dist$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["createClient"])(("TURBOPACK compile-time value", "https://zrehiuirumqbesaawqee.supabase.co"), process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false
        }
    });
}
}),
"[project]/lib/anthropic/prompts/qualifier.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/anthropic/prompts/qualifier.ts
__turbopack_context__.s([
    "buildPrompt",
    ()=>buildPrompt,
    "outputSchema",
    ()=>outputSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-route] (ecmascript) <export * as z>");
;
const outputSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    fit_score: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().int().min(0).max(100),
    reasoning: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(600),
    disqualifiers: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string()),
    recommended_channel: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'email',
        'linkedin',
        'voice',
        'instagram',
        'none'
    ]),
    urgency: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'now',
        'this_month',
        'nurture',
        'park'
    ])
});
function buildPrompt(input) {
    const i = input;
    const system = `You are the Qualifier on an AI sales team. You score inbound and sourced leads against an ideal customer profile. You are deliberately hard to impress: most leads are mediocre, and saying so is your job.

Scoring rubric, out of 100:
- ICP fit (0-35): industry, company size, geography match against the profile
- Buying trigger (0-30): a recent event that creates urgency. No trigger caps this at 5.
- Authority (0-20): can this person sign, or at least own the budget line
- Reachability (0-15): verified contact details, and a channel we can legally use

Bands: 80+ means contact today. 60-79 means this month. 40-59 means nurture. Below 40 means park, do not spend outreach on it.

Hard disqualifiers, which force a score below 20 regardless of other factors: a competitor, an existing client, a company below the minimum size in the profile, a role with no budget influence, or a generic inbox such as info@ or contact@ as the only contact.

Be blunt in your reasoning. If the only positive is that the industry matches, say the lead is weak and explain why. Inflated scores waste real outreach budget.

Return only a JSON object matching this shape, with no prose and no markdown fences:
{"fit_score": number, "reasoning": string, "disqualifiers": string[], "recommended_channel": "email"|"linkedin"|"voice"|"instagram"|"none", "urgency": "now"|"this_month"|"nurture"|"park"}`;
    const user = `Ideal customer profile:
${JSON.stringify(i.icp ?? {}, null, 2)}

Lead:
${JSON.stringify(i.lead ?? {}, null, 2)}

Buying triggers detected (empty means none found):
${JSON.stringify(i.triggers ?? [], null, 2)}

What this team has learned about which leads actually convert:
${(i.memory ?? []).map((m)=>`- [${m.memory_type}] ${m.content} (win rate ${m.success_rate ?? 'unknown'})`).join('\n') || '- nothing learned yet, use the rubric alone'}

Score this lead.`;
    return {
        system,
        user
    };
}
}),
"[project]/lib/anthropic/prompts/content-creator.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/anthropic/prompts/content-creator.ts
__turbopack_context__.s([
    "buildPrompt",
    ()=>buildPrompt,
    "outputSchema",
    ()=>outputSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-route] (ecmascript) <export * as z>");
;
const outputSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    subject: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(80).optional(),
    body: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    opening_line_rationale: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(300),
    personalisation_anchor: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
    word_count: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().int()
});
const CHANNEL_RULES = {
    email: `Subject line: 4 to 7 words, lowercase, no colons, reads like a note from a colleague rather than a campaign. Never use the company name plus a benefit claim.
Body: 90 to 130 words. One idea. One question at the end. No bullet lists. No signature block, that gets appended later.
An unsubscribe line is appended automatically, so do not write one.`,
    linkedin: `Under 300 characters, because the connection-request note is capped and long DMs go unread.
No links, they suppress reach and read as spam.
This will be sent by a human from their own account, so write it in first person as that person.`,
    instagram: `Under 400 characters, conversational, lowercase-leaning.
This is a reply inside an existing conversation, never a cold approach, so reference what they said.
No pitch in the first message. Ask one question.`,
    voice: `Write a call opening of 25 to 40 words, to be spoken.
The first sentence must disclose that this is an AI assistant and name the calling company. This is a legal requirement, not a stylistic choice.
The second sentence states why you are calling, referencing their enquiry.
End with a yes or no question that is easy to answer.
Short words. No subordinate clauses. It has to survive being heard once.`
};
function buildPrompt(input) {
    const i = input;
    const channel = i.channel ?? 'email';
    const system = `You write outbound sales copy for an AI sales team. Your copy gets replies because it sounds like one competent person noticing something specific about another person's business, not like marketing.

How you open:
- Lead with the problem you believe they have, inferred from something real and verifiable about them. Never open with a greeting plus your credentials.
- Mirror their situation in the first line so they recognise themselves in it.
- Diagnose before you offer. Name what you think is going wrong before you mention what you do.

How you prove:
- Frame proof as recollection, not assertion. "Recently I worked with a plumbing firm in Sydney sitting on the same problem" beats "we have extensive experience".
- Use context, then action, then result, with a real number attached. If you have no real number available in the context given to you, use no number at all. Never invent a statistic, a client name, or a percentage.

How you close:
- One question. It should be easy to answer and should lead toward a conversation, not a purchase.
- Never ask for a meeting in the first message on any channel.

Style constraints:
- No em dashes or long dashes anywhere. Use commas, colons, or separate sentences.
- No exclamation marks. No "I hope this finds you well". No "quick question". No "just following up". No "circling back". No "synergy", "leverage", "unlock", "game-changer", "revolutionise".
- Write at a plain reading level. Short sentences beat clever ones.
- Do not use the recipient's first name more than once.

Channel rules for this message:
${CHANNEL_RULES[channel] ?? CHANNEL_RULES.email}

Return only a JSON object with no prose and no markdown fences:
{"subject": string (omit for non-email), "body": string, "opening_line_rationale": string, "personalisation_anchor": string, "word_count": number}

personalisation_anchor must be the specific verifiable fact your opening is built on. If nothing specific is available in the context, set it to "none" and write a message that is honest about being a cold approach rather than faking familiarity.`;
    const priorMessages = (i.history ?? []).map((h, n)=>`Message ${n + 1} (${h.channel}): ${h.body.slice(0, 300)}\nTheir reply: ${h.reply_body ?? 'no reply'}`).join('\n\n');
    const user = `Who we are and what we offer:
${i.offer ?? 'not specified'}

Sending as: ${i.sender ?? 'not specified'}

The person:
${JSON.stringify(i.lead ?? {}, null, 2)}

Recent events at their company, your best personalisation material:
${JSON.stringify(i.triggers ?? [], null, 2)}

What we have already sent them, do not repeat any of it:
${priorMessages || 'nothing yet, this is the first contact'}

Openers and angles that have worked for this team:
${(i.memory ?? []).filter((m)=>m.memory_type === 'winning_opener' || m.memory_type === 'objection_response').map((m)=>`- ${m.content} (reply rate ${m.success_rate ?? 'unknown'})`).join('\n') || '- nothing learned yet'}

This is step ${i.step_number ?? 1} of the sequence. Write the ${channel} message.`;
    return {
        system,
        user
    };
}
}),
"[project]/lib/anthropic/prompts/follow-up.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/anthropic/prompts/follow-up.ts
__turbopack_context__.s([
    "buildPrompt",
    ()=>buildPrompt,
    "outputSchema",
    ()=>outputSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-route] (ecmascript) <export * as z>");
;
const outputSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    sentiment: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'positive',
        'neutral',
        'negative',
        'objection',
        'unsubscribe',
        'no_reply'
    ]),
    next_action: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'send_next_step',
        'wait',
        'switch_channel',
        'escalate_to_human',
        'mark_won',
        'mark_lost',
        'suppress',
        'park_for_nurture'
    ]),
    next_channel: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'email',
        'sms',
        'voice',
        'linkedin',
        'instagram',
        'none'
    ]),
    wait_hours: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].number().int().min(0).max(2160),
    new_stage: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'contacted',
        'engaged',
        'meeting_booked',
        'won',
        'lost',
        'parked',
        'suppressed'
    ]),
    reasoning: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(400)
});
function buildPrompt(input) {
    const i = input;
    const system = `You are the Follow-up manager on an AI sales team. You read what happened on a lead and decide exactly one next action. You do not write copy, you route.

Rules you never break:
- Any reply containing a request to stop, unsubscribe, remove, or opt out returns sentiment "unsubscribe" and next_action "suppress". No judgement call, no exceptions, even if the rest of the message is warm.
- A reply from an out-of-office autoresponder is not a real reply. Return "no_reply" and wait until the return date if one is given.
- If the lead asked a direct question, expressed a specific objection, mentioned pricing, or referenced a competitor, escalate to a human. Those replies are worth more than a fast response.
- Never escalate a lead you have already escalated on the same reply.
- Do not switch to a channel the lead has no live consent for. The consent records you were given are authoritative. If the channel you want is not covered, choose one that is, or wait.
- Never suggest a channel where the lead has no contact detail.

Cadence discipline:
- No reply after step one: wait 72 hours, then send the next step on the same channel.
- No reply after step two: wait 96 hours, then switch channel if consent allows.
- No reply after step three: park for nurture. Do not send a fourth message. Sequences that keep pushing past three ignored messages generate complaints, and complaints cost you the sending domain.
- Positive but not ready: park for nurture with a 30 to 90 day wait, and say in your reasoning what event should wake them up.

Return only a JSON object with no prose and no markdown fences, matching:
{"sentiment": ..., "next_action": ..., "next_channel": ..., "wait_hours": number, "new_stage": ..., "reasoning": string}`;
    const user = `Lead:
${JSON.stringify(i.lead ?? {}, null, 2)}

Assigned sequence:
${JSON.stringify(i.sequence ?? null, null, 2)}

Live consent on file, this decides which channels are available to you:
${JSON.stringify(i.consent ?? [], null, 2)}

Full interaction history, oldest first:
${JSON.stringify(i.history ?? [], null, 2)}

Decide the single next action.`;
    return {
        system,
        user
    };
}
}),
"[project]/lib/anthropic/prompts/sales-manager.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/anthropic/prompts/sales-manager.ts
__turbopack_context__.s([
    "buildPrompt",
    ()=>buildPrompt,
    "outputSchema",
    ()=>outputSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-route] (ecmascript) <export * as z>");
;
const outputSchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    headline: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(200),
    pipeline_health: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
        'healthy',
        'thin',
        'stalling',
        'blocked'
    ]),
    bottleneck: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().max(300),
    actions: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
        instruction: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
        target_agent: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string(),
        priority: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].enum([
            'high',
            'medium',
            'low'
        ])
    })).max(5),
    needs_human: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string()).max(5)
});
function buildPrompt(input) {
    const i = input;
    const system = `You are the Sales manager on an AI sales team. Once a day you read the pipeline and issue at most five instructions to your agents. You are accountable for revenue, not activity.

How you think:
- Find the single biggest bottleneck, not a list of everything imperfect. If leads are being sourced but not contacted, that is the bottleneck and nothing else matters today.
- Judge on conversion between stages, not on volume at any one stage. A thousand sourced leads with four contacted is a broken pipeline, not a good month.
- A reply rate under 3 percent means the message is wrong, not that the volume is too low. Instruct the content creator to change the angle before you instruct anyone to send more.
- If more than a fifth of actions are blocked by the consent gate, the sourcing filters are pulling unreachable leads. That is a sourcing problem, not a compliance problem.

What you must not do:
- Never instruct an agent to increase send volume as a fix for a low reply rate.
- Never instruct anyone to contact a lead on a channel that lacks consent. The gate will block it and you will have wasted a cycle.
- Do not issue instructions that are restatements of an agent's normal job. Only issue an instruction if it changes what the agent would otherwise do.

needs_human is for things no agent should decide: pricing exceptions, contract questions, an angry reply, a lead who asked to speak to a person, or a compliance question.

Return only a JSON object with no prose and no markdown fences, matching:
{"headline": string, "pipeline_health": "healthy"|"thin"|"stalling"|"blocked", "bottleneck": string, "actions": [{"instruction": string, "target_agent": string, "priority": "high"|"medium"|"low"}], "needs_human": string[]}`;
    const user = `Pipeline by stage:
${JSON.stringify(i.pipeline ?? {}, null, 2)}

Channel performance over the last 30 days:
${JSON.stringify(i.channelStats ?? {}, null, 2)}

What the team has learned so far:
${(i.memory ?? []).map((m)=>`- [${m.agent}/${m.memory_type}] ${m.content}`).join('\n') || '- nothing yet'}

Run today's review.`;
    return {
        system,
        user
    };
}
}),
"[project]/lib/cadence/registry.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/cadence/registry.ts
//
// One entry per AI employee. Adding an agent means adding a row here plus a
// prompt file. Nothing else in the runtime changes.
__turbopack_context__.s([
    "AGENTS",
    ()=>AGENTS
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$qualifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/anthropic/prompts/qualifier.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/anthropic/prompts/content-creator.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$follow$2d$up$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/anthropic/prompts/follow-up.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$sales$2d$manager$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/anthropic/prompts/sales-manager.ts [app-route] (ecmascript)");
;
;
;
;
const AGENTS = {
    qualifier: {
        slug: 'qualifier',
        label: 'Qualifier',
        // Scoring against explicit criteria is classification, not creative work.
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1024,
        reads: [
            'lead',
            'lead_triggers',
            'agent_memory'
        ],
        writesChannels: [],
        buildPrompt: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$qualifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"],
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$qualifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    content_creator: {
        slug: 'content_creator',
        label: 'Content creator',
        model: 'claude-opus-5',
        maxTokens: 2048,
        reads: [
            'lead',
            'lead_triggers',
            'action_history',
            'agent_memory'
        ],
        writesChannels: [],
        buildPrompt: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"],
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    follow_up: {
        slug: 'follow_up',
        label: 'Follow-up manager',
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 1024,
        reads: [
            'lead',
            'action_history',
            'sequence',
            'consent'
        ],
        writesChannels: [],
        buildPrompt: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$follow$2d$up$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"],
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$follow$2d$up$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    sales_manager: {
        slug: 'sales_manager',
        label: 'Sales manager',
        model: 'claude-opus-5',
        maxTokens: 4096,
        reads: [
            'pipeline_summary',
            'agent_memory'
        ],
        writesChannels: [],
        buildPrompt: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$sales$2d$manager$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"],
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$sales$2d$manager$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    // Channel specialists reuse the content creator's prompt with a channel
    // constraint injected. Split them into their own prompt files once each
    // channel's voice diverges enough to need it.
    email_specialist: {
        slug: 'email_specialist',
        label: 'Email specialist',
        model: 'claude-opus-5',
        maxTokens: 2048,
        reads: [
            'lead',
            'lead_triggers',
            'action_history',
            'agent_memory'
        ],
        writesChannels: [
            'email'
        ],
        buildPrompt: (i)=>__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"]({
                ...i,
                channel: 'email'
            }),
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    linkedin_specialist: {
        slug: 'linkedin_specialist',
        label: 'LinkedIn specialist',
        model: 'claude-opus-5',
        maxTokens: 1024,
        reads: [
            'lead',
            'lead_triggers',
            'action_history',
            'agent_memory'
        ],
        writesChannels: [
            'linkedin'
        ],
        buildPrompt: (i)=>__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"]({
                ...i,
                channel: 'linkedin'
            }),
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    instagram_specialist: {
        slug: 'instagram_specialist',
        label: 'Instagram specialist',
        model: 'claude-opus-5',
        maxTokens: 1024,
        reads: [
            'lead',
            'action_history',
            'agent_memory'
        ],
        writesChannels: [
            'instagram'
        ],
        buildPrompt: (i)=>__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"]({
                ...i,
                channel: 'instagram'
            }),
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    voice_specialist: {
        slug: 'voice_specialist',
        label: 'Voice specialist',
        model: 'claude-opus-5',
        maxTokens: 2048,
        reads: [
            'lead',
            'lead_triggers',
            'action_history',
            'consent'
        ],
        writesChannels: [
            'voice'
        ],
        buildPrompt: (i)=>__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"]({
                ...i,
                channel: 'voice'
            }),
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$content$2d$creator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    },
    sourcing_scout: {
        slug: 'sourcing_scout',
        label: 'Sourcing scout',
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 2048,
        reads: [
            'agent_memory'
        ],
        writesChannels: [],
        buildPrompt: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$qualifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["buildPrompt"],
        outputSchema: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$anthropic$2f$prompts$2f$qualifier$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["outputSchema"]
    }
};
}),
"[project]/lib/cadence/runtime.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/cadence/runtime.ts
//
// One function runs every agent. Context loading is driven by the agent's
// declared `reads` scope, so an agent can never see more of the brain than
// it asked for.
__turbopack_context__.s([
    "runAgent",
    ()=>runAgent
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$client$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__Anthropic__as__default$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/client.mjs [app-route] (ecmascript) <export Anthropic as default>");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$registry$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/cadence/registry.ts [app-route] (ecmascript)");
;
;
const anthropic = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$client$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__Anthropic__as__default$3e$__["default"]({
    apiKey: process.env.ANTHROPIC_API_KEY
});
async function runAgent(db, opts) {
    const def = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$registry$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AGENTS"][opts.agent];
    const started = Date.now();
    try {
        const context = await loadContext(db, def.reads, opts);
        const { system, user } = def.buildPrompt({
            ...context,
            ...opts.extra
        });
        const response = await anthropic.messages.create({
            model: def.model,
            max_tokens: def.maxTokens,
            system,
            messages: [
                {
                    role: 'user',
                    content: user
                }
            ]
        });
        const text = response.content.filter((b)=>b.type === 'text').map((b)=>b.text).join('\n');
        const parsed = def.outputSchema.safeParse(JSON.parse(stripFences(text)));
        if (!parsed.success) {
            await logRun(db, {
                ...opts,
                model: def.model,
                response,
                started,
                ok: false,
                error: `schema_mismatch: ${parsed.error.message}`
            });
            return {
                ok: false,
                error: 'Agent returned an unexpected shape'
            };
        }
        const runId = await logRun(db, {
            ...opts,
            model: def.model,
            response,
            started,
            ok: true,
            output: parsed.data
        });
        return {
            ok: true,
            data: parsed.data,
            runId
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        await logRun(db, {
            ...opts,
            model: def.model,
            started,
            ok: false,
            error: message
        });
        return {
            ok: false,
            error: message
        };
    }
}
/** Models sometimes wrap JSON in markdown fences despite instructions. */ function stripFences(text) {
    return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}
async function loadContext(db, scopes, opts) {
    const ctx = {};
    const { workspaceId, leadId } = opts;
    if (scopes.includes('lead') && leadId) {
        const { data } = await db.from('leads').select('id, full_name, title, seniority, company_name, company_domain, employee_count, industry, country, timezone, stage, fit_score, fit_reasoning').eq('id', leadId).eq('workspace_id', workspaceId).single();
        ctx.lead = data;
    }
    if (scopes.includes('lead_triggers') && leadId) {
        const { data } = await db.from('lead_triggers').select('trigger_type, headline, detected_at').eq('lead_id', leadId).or(`decays_at.is.null,decays_at.gt.${new Date().toISOString()}`).order('detected_at', {
            ascending: false
        }).limit(5);
        ctx.triggers = data ?? [];
    }
    if (scopes.includes('consent') && leadId) {
        const { data } = await db.from('consent_records').select('basis, channels, captured_at, expires_at').eq('lead_id', leadId).is('revoked_at', null);
        ctx.consent = data ?? [];
    }
    if (scopes.includes('action_history') && leadId) {
        const { data } = await db.from('actions').select('agent, channel, step_number, subject, body, status, sent_at, opened_at, replied_at, reply_body, reply_sentiment').eq('lead_id', leadId).order('created_at', {
            ascending: true
        }).limit(20);
        ctx.history = data ?? [];
    }
    if (scopes.includes('sequence') && leadId) {
        const { data: lead } = await db.from('leads').select('assigned_sequence_id').eq('id', leadId).single();
        if (lead?.assigned_sequence_id) {
            const { data } = await db.from('sequences').select('name, steps, reply_count, sent_count').eq('id', lead.assigned_sequence_id).single();
            ctx.sequence = data;
        }
    }
    if (scopes.includes('agent_memory')) {
        const { data } = await db.from('agent_memory').select('agent, memory_type, content, success_rate, sample_size, confidence').eq('workspace_id', workspaceId).is('retired_at', null)// Only surface lessons with enough evidence to trust.
        .gte('sample_size', 20).order('confidence', {
            ascending: false
        }).limit(15);
        ctx.memory = data ?? [];
    }
    if (scopes.includes('pipeline_summary')) {
        const { data } = await db.from('leads').select('stage, fit_score').eq('workspace_id', workspaceId);
        const byStage = {};
        for (const row of data ?? [])byStage[row.stage] = (byStage[row.stage] ?? 0) + 1;
        ctx.pipeline = {
            byStage,
            total: data?.length ?? 0
        };
    }
    return ctx;
}
async function logRun(db, a) {
    const { data } = await db.from('agent_runs').insert({
        workspace_id: a.workspaceId,
        agent: a.agent,
        lead_id: a.leadId ?? null,
        model: a.model,
        input_tokens: a.response?.usage.input_tokens ?? 0,
        output_tokens: a.response?.usage.output_tokens ?? 0,
        duration_ms: Date.now() - a.started,
        ok: a.ok,
        error: a.error ?? null,
        raw_output: a.output ?? null
    }).select('id').single();
    return data?.id;
}
}),
"[project]/app/api/agents/qualifier/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// app/api/agents/qualifier/route.ts
__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-route] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/supabase/server.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$runtime$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/cadence/runtime.ts [app-route] (ecmascript)");
;
;
;
;
const bodySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    workspaceId: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().uuid(),
    leadIds: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].array(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().uuid()).min(1).max(50)
});
async function POST(request) {
    const db = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["supabaseServer"])();
    const { data: { user } } = await db.auth.getUser();
    if (!user) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: 'Unauthorised'
    }, {
        status: 401
    });
    const parsed = bodySchema.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: parsed.error.flatten()
        }, {
            status: 400
        });
    }
    const { workspaceId, leadIds } = parsed.data;
    // RLS confirms ownership, so a miss here means it is not theirs.
    const { data: ws } = await db.from('workspaces').select('id').eq('id', workspaceId).single();
    if (!ws) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        error: 'Workspace not found'
    }, {
        status: 404
    });
    const { data: icp } = await db.from('icp_profiles').select('name, filters, trigger_types').eq('workspace_id', workspaceId).eq('active', true).limit(1).single();
    const results = [];
    for (const leadId of leadIds){
        const run = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$runtime$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runAgent"])(db, {
            agent: 'qualifier',
            workspaceId,
            leadId,
            extra: {
                icp
            }
        });
        if (!run.ok || !run.data) {
            results.push({
                leadId,
                ok: false,
                error: run.error
            });
            continue;
        }
        const { fit_score, reasoning, urgency } = run.data;
        await db.from('leads').update({
            fit_score,
            fit_reasoning: reasoning,
            stage: urgency === 'park' ? 'parked' : 'qualified',
            next_action_at: nextActionFor(urgency)
        }).eq('id', leadId).eq('workspace_id', workspaceId);
        results.push({
            leadId,
            ok: true,
            ...run.data
        });
    }
    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        data: results
    });
}
function nextActionFor(urgency) {
    const hours = {
        now: 0,
        this_month: 48,
        nurture: 720
    };
    if (!(urgency in hours)) return null;
    return new Date(Date.now() + hours[urgency] * 3_600_000).toISOString();
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__94f19deb._.js.map