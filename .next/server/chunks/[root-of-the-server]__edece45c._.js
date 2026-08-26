module.exports = [
"[project]/.next-internal/server/app/api/queue/process/route/actions.js [app-rsc] (server actions loader, ecmascript)", ((__turbopack_context__, module, exports) => {

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
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[project]/lib/cadence/consent.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/cadence/consent.ts
//
// The single choke point for every outbound action in Cadence.
// No adapter sends anything without a passing verdict from here.
__turbopack_context__.s([
    "evaluateConsent",
    ()=>evaluateConsent,
    "recordEnquiryConsent",
    ()=>recordEnquiryConsent
]);
/**
 * What each channel minimally requires, by jurisdiction.
 *
 * 'legitimate_b2b' means licensed B2B data, work address, no prior relationship.
 * It is enough for email in IN/US/AU with a working unsubscribe. It is never
 * enough for voice or SMS anywhere.
 */ const REQUIREMENTS = {
    IN: {
        email: [
            'legitimate_b2b',
            'enquiry_implied',
            'oral',
            'written'
        ],
        // TRAI: promotional voice/SMS needs registered consent. Enquiry within the
        // service window is the one exception, and only for service content.
        sms: [
            'enquiry_implied',
            'written'
        ],
        voice: [
            'enquiry_implied',
            'written'
        ]
    },
    US: {
        email: [
            'legitimate_b2b',
            'enquiry_implied',
            'oral',
            'written'
        ],
        // TCPA: AI voice counts as artificial voice. Marketing needs prior express
        // written consent. We do not accept 'oral' for marketing by default.
        sms: [
            'written'
        ],
        voice: [
            'written'
        ]
    },
    AU: {
        email: [
            'legitimate_b2b',
            'enquiry_implied',
            'oral',
            'written'
        ],
        sms: [
            'oral',
            'written'
        ],
        voice: [
            'oral',
            'written'
        ]
    },
    GB: {
        email: [
            'legitimate_b2b',
            'enquiry_implied',
            'oral',
            'written'
        ],
        sms: [
            'written'
        ],
        voice: [
            'oral',
            'written'
        ]
    }
};
/**
 * Channels with no compliant automated path. These are draft-only: the agent
 * writes the message, a human sends it. This is a platform-terms constraint,
 * not a consent one, so no consent record can unlock it.
 */ const HUMAN_SEND_ONLY = [
    'linkedin',
    'instagram'
];
/** TRAI treats an inbound enquiry as implied consent for a limited window. */ const ENQUIRY_WINDOW_DAYS = 90;
function jurisdictionFor(country, fallback) {
    if (country && REQUIREMENTS[country]) return country;
    const first = fallback.find((j)=>REQUIREMENTS[j]);
    return first ?? 'IN';
}
async function evaluateConsent(db, opts) {
    const { workspaceId, leadId, channel } = opts;
    const notes = [];
    const { data: lead, error: leadErr } = await db.from('leads').select('id, email, phone, company_domain, country, stage').eq('id', leadId).eq('workspace_id', workspaceId).single();
    if (leadErr || !lead) return {
        allowed: false,
        reason: 'lead_not_found'
    };
    if (lead.stage === 'suppressed') return {
        allowed: false,
        reason: 'lead_suppressed'
    };
    // 1. Suppression always wins, on every channel, no exceptions.
    const suppressed = await isSuppressed(db, workspaceId, {
        email: lead.email,
        phone: lead.phone,
        domain: lead.company_domain
    });
    if (suppressed) return {
        allowed: false,
        reason: `suppressed:${suppressed}`
    };
    // 2. Do we even have the identifier this channel needs?
    if (channel === 'email' && !lead.email) return {
        allowed: false,
        reason: 'no_email'
    };
    if ((channel === 'sms' || channel === 'voice') && !lead.phone) return {
        allowed: false,
        reason: 'no_phone'
    };
    // 3. Platform-terms channels never auto-send.
    if (HUMAN_SEND_ONLY.includes(channel)) {
        return {
            allowed: true,
            basis: 'none',
            requiresApproval: true,
            notes: [
                `${channel} has no compliant send API; queued for human send`
            ]
        };
    }
    const { data: workspace } = await db.from('workspaces').select('jurisdictions, dlt_registered').eq('id', workspaceId).single();
    const jurisdiction = jurisdictionFor(lead.country, workspace?.jurisdictions ?? [
        'IN'
    ]);
    const accepted = REQUIREMENTS[jurisdiction]?.[channel];
    if (!accepted) {
        return {
            allowed: false,
            reason: `channel_not_permitted:${jurisdiction}:${channel}`
        };
    }
    // 4. India: no DLT registration means no automated voice or SMS at all.
    if (jurisdiction === 'IN' && (channel === 'sms' || channel === 'voice')) {
        if (!workspace?.dlt_registered) {
            return {
                allowed: false,
                reason: 'dlt_not_registered'
            };
        }
    }
    // 5. Find the strongest live consent record for this channel.
    const { data: records } = await db.from('consent_records').select('basis, channels, captured_at, expires_at').eq('lead_id', leadId).is('revoked_at', null).order('captured_at', {
        ascending: false
    });
    const now = Date.now();
    const live = (records ?? []).filter((r)=>{
        if (!r.channels.includes(channel)) return false;
        if (r.expires_at && new Date(r.expires_at).getTime() < now) return false;
        if (r.basis === 'enquiry_implied') {
            const age = now - new Date(r.captured_at).getTime();
            return age <= ENQUIRY_WINDOW_DAYS * 86_400_000;
        }
        return true;
    });
    // Strongest basis first.
    const ranked = [
        'written',
        'oral',
        'enquiry_implied',
        'legitimate_b2b'
    ];
    const best = ranked.find((b)=>live.some((r)=>r.basis === b));
    if (!best || !accepted.includes(best)) {
        return {
            allowed: false,
            reason: `insufficient_consent:${jurisdiction}:${channel}:have=${best ?? 'none'}`
        };
    }
    if (best === 'enquiry_implied') {
        notes.push(`enquiry window: service content only, no promotional offers`);
    }
    if (best === 'legitimate_b2b') {
        notes.push('B2B basis: work address only, unsubscribe link mandatory');
    }
    if (channel === 'voice') {
        notes.push('disclose AI voice in the opening line; identify the calling entity');
    }
    return {
        allowed: true,
        basis: best,
        // Voice is the highest-risk channel, so it stays human-approved until you
        // flip this deliberately.
        requiresApproval: channel === 'voice',
        notes
    };
}
async function isSuppressed(db, workspaceId, ids) {
    const filters = [];
    if (ids.email) filters.push(`email.eq.${ids.email.toLowerCase()}`);
    if (ids.phone) filters.push(`phone.eq.${ids.phone}`);
    if (ids.domain) filters.push(`domain.eq.${ids.domain.toLowerCase()}`);
    if (!filters.length) return null;
    const { data } = await db.from('suppression_list').select('reason').eq('workspace_id', workspaceId).or(filters.join(',')).limit(1);
    return data?.[0]?.reason ?? null;
}
async function recordEnquiryConsent(db, opts) {
    return db.from('consent_records').insert({
        workspace_id: opts.workspaceId,
        lead_id: opts.leadId,
        basis: 'enquiry_implied',
        channels: opts.channels ?? [
            'email',
            'sms',
            'voice'
        ],
        source_description: opts.sourceDescription,
        evidence_url: opts.evidenceUrl,
        expires_at: new Date(Date.now() + ENQUIRY_WINDOW_DAYS * 86_400_000).toISOString()
    });
}
}),
"[project]/lib/cadence/adapters/email.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// lib/cadence/adapters/email.ts
//
// The email send path. Every send goes through evaluateConsent first, records
// an actions row with the returned consent_basis before the network call, and
// carries a signed unsubscribe link that writes to suppression_list when used.
// This adapter never decides consent itself; it only obeys the gate.
__turbopack_context__.s([
    "deliverQueuedEmailAction",
    ()=>deliverQueuedEmailAction,
    "sendEmail",
    ()=>sendEmail,
    "unsubscribeToken",
    ()=>unsubscribeToken,
    "verifyUnsubscribeToken",
    ()=>verifyUnsubscribeToken
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$consent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/cadence/consent.ts [app-route] (ecmascript)");
;
;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
function appUrl() {
    const explicit = ("TURBOPACK compile-time value", "http://localhost:3000");
    if ("TURBOPACK compile-time truthy", 1) return explicit.replace(/\/$/, '');
    //TURBOPACK unreachable
    ;
}
function unsubscribeToken(workspaceId, email) {
    const payload = Buffer.from(JSON.stringify({
        w: workspaceId,
        e: email.toLowerCase()
    })).toString('base64url');
    const signature = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["default"].createHmac('sha256', process.env.CRON_SECRET ?? '').update(payload).digest('base64url');
    return `${payload}.${signature}`;
}
function verifyUnsubscribeToken(token) {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["default"].createHmac('sha256', process.env.CRON_SECRET ?? '').update(payload).digest('base64url');
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["default"].timingSafeEqual(given, want)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!parsed.w || !parsed.e) return null;
        return {
            workspaceId: parsed.w,
            email: parsed.e
        };
    } catch  {
        return null;
    }
}
function unsubscribeUrl(workspaceId, email) {
    return `${appUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken(workspaceId, email))}`;
}
function withUnsubscribe(body, url) {
    return `${body}\n\nTo stop receiving these emails, unsubscribe here: ${url}`;
}
/** The single place the network call to Resend happens. */ async function postToResend(params) {
    const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`
        },
        body: JSON.stringify({
            from: process.env.EMAIL_FROM,
            to: [
                params.to
            ],
            subject: params.subject,
            text: params.text,
            headers: {
                'List-Unsubscribe': `<${params.listUnsubscribe}>`
            }
        })
    });
    if (!response.ok) {
        const text = await response.text();
        return {
            ok: false,
            error: `resend_${response.status}: ${text.slice(0, 300)}`
        };
    }
    const json = await response.json();
    return {
        ok: true,
        id: json.id ?? null
    };
}
async function sendEmail(db, input) {
    const { workspaceId, leadId, subject } = input;
    const agent = input.agent ?? 'email_specialist';
    const base = {
        workspace_id: workspaceId,
        lead_id: leadId,
        agent,
        channel: 'email',
        subject,
        sequence_id: input.sequenceId ?? null,
        step_number: input.stepNumber ?? null
    };
    // 1. The consent gate decides first. Nothing sends without a passing verdict.
    const verdict = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$consent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["evaluateConsent"])(db, {
        workspaceId,
        leadId,
        channel: 'email'
    });
    if (!verdict.allowed) {
        const { data } = await db.from('actions').insert({
            ...base,
            body: input.body,
            status: 'blocked',
            consent_basis: null,
            block_reason: verdict.reason
        }).select('id').single();
        return {
            status: 'blocked',
            actionId: data?.id ?? null,
            reason: verdict.reason
        };
    }
    // 2. Recipient address.
    const { data: lead } = await db.from('leads').select('email').eq('id', leadId).eq('workspace_id', workspaceId).single();
    const email = lead?.email ?? null;
    if (!email) {
        const { data } = await db.from('actions').insert({
            ...base,
            body: input.body,
            status: 'blocked',
            consent_basis: verdict.basis,
            block_reason: 'no_email'
        }).select('id').single();
        return {
            status: 'blocked',
            actionId: data?.id ?? null,
            reason: 'no_email'
        };
    }
    const url = unsubscribeUrl(workspaceId, email);
    const bodyWithUnsub = withUnsubscribe(input.body, url);
    // 3. Record the actions row with the returned consent_basis BEFORE sending.
    const status = verdict.requiresApproval ? 'awaiting_approval' : 'queued';
    const { data: action } = await db.from('actions').insert({
        ...base,
        body: bodyWithUnsub,
        status,
        consent_basis: verdict.basis
    }).select('id').single();
    const actionId = action?.id ?? null;
    // 4. If the gate wants a human to approve first, stop before sending.
    if (verdict.requiresApproval) {
        return {
            status: 'awaiting_approval',
            actionId
        };
    }
    // 5. Send.
    try {
        const sent = await postToResend({
            to: email,
            subject,
            text: bodyWithUnsub,
            listUnsubscribe: url
        });
        if (!sent.ok) {
            if (actionId) {
                await db.from('actions').update({
                    status: 'failed',
                    block_reason: sent.error
                }).eq('id', actionId);
            }
            return {
                status: 'failed',
                actionId,
                error: sent.error
            };
        }
        const now = new Date().toISOString();
        if (actionId) {
            await db.from('actions').update({
                status: 'sent',
                sent_at: now,
                provider_message_id: sent.id
            }).eq('id', actionId);
        }
        await db.from('leads').update({
            last_contacted_at: now
        }).eq('id', leadId).eq('workspace_id', workspaceId);
        return {
            status: 'sent',
            actionId,
            providerMessageId: sent.id
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        if (actionId) {
            await db.from('actions').update({
                status: 'failed',
                block_reason: message
            }).eq('id', actionId);
        }
        return {
            status: 'failed',
            actionId,
            error: message
        };
    }
}
async function deliverQueuedEmailAction(db, action) {
    const verdict = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$consent$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["evaluateConsent"])(db, {
        workspaceId: action.workspace_id,
        leadId: action.lead_id,
        channel: 'email'
    });
    if (!verdict.allowed) {
        await db.from('actions').update({
            status: 'blocked',
            block_reason: verdict.reason
        }).eq('id', action.id);
        return {
            status: 'blocked',
            actionId: action.id,
            reason: verdict.reason
        };
    }
    if (verdict.requiresApproval) {
        await db.from('actions').update({
            status: 'awaiting_approval',
            consent_basis: verdict.basis
        }).eq('id', action.id);
        return {
            status: 'awaiting_approval',
            actionId: action.id
        };
    }
    const { data: lead } = await db.from('leads').select('email').eq('id', action.lead_id).eq('workspace_id', action.workspace_id).single();
    const email = lead?.email ?? null;
    if (!email) {
        await db.from('actions').update({
            status: 'blocked',
            block_reason: 'no_email',
            consent_basis: verdict.basis
        }).eq('id', action.id);
        return {
            status: 'blocked',
            actionId: action.id,
            reason: 'no_email'
        };
    }
    const url = unsubscribeUrl(action.workspace_id, email);
    const text = withUnsubscribe(action.body, url);
    // Record the basis before the send.
    await db.from('actions').update({
        consent_basis: verdict.basis
    }).eq('id', action.id);
    try {
        const sent = await postToResend({
            to: email,
            subject: action.subject ?? '',
            text,
            listUnsubscribe: url
        });
        if (!sent.ok) {
            await db.from('actions').update({
                status: 'failed',
                block_reason: sent.error
            }).eq('id', action.id);
            return {
                status: 'failed',
                actionId: action.id,
                error: sent.error
            };
        }
        const now = new Date().toISOString();
        await db.from('actions').update({
            status: 'sent',
            sent_at: now,
            provider_message_id: sent.id,
            body: text
        }).eq('id', action.id);
        await db.from('leads').update({
            last_contacted_at: now
        }).eq('id', action.lead_id).eq('workspace_id', action.workspace_id);
        return {
            status: 'sent',
            actionId: action.id,
            providerMessageId: sent.id
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown_error';
        await db.from('actions').update({
            status: 'failed',
            block_reason: message
        }).eq('id', action.id);
        return {
            status: 'failed',
            actionId: action.id,
            error: message
        };
    }
}
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
"[project]/app/api/queue/process/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// app/api/queue/process/route.ts
//
// User-triggered version of the send queue, scoped to the caller's workspace.
// This is what the dashboard "Process send queue" button calls, so the queue
// can run on demand without a cron (useful on plans without frequent crons).
__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__ = __turbopack_context__.i("[project]/node_modules/zod/v4/classic/external.js [app-route] (ecmascript) <export * as z>");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$adapters$2f$email$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/cadence/adapters/email.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/supabase/server.ts [app-route] (ecmascript)");
;
;
;
;
const bodySchema = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].object({
    workspaceId: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$zod$2f$v4$2f$classic$2f$external$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$export__$2a$__as__z$3e$__["z"].string().uuid()
});
async function POST(request) {
    try {
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
        const { workspaceId } = parsed.data;
        // RLS ownership check before running under the service role.
        const { data: ws } = await db.from('workspaces').select('id').eq('id', workspaceId).single();
        if (!ws) return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Workspace not found'
        }, {
            status: 404
        });
        const service = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$supabase$2f$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["supabaseService"])();
        const { data: due } = await service.from('actions').select('id, workspace_id, lead_id, subject, body').eq('workspace_id', workspaceId).eq('status', 'queued').eq('channel', 'email').lte('scheduled_for', new Date().toISOString()).order('scheduled_for', {
            ascending: true
        }).limit(50);
        let sent = 0;
        let blocked = 0;
        let failed = 0;
        for (const action of due ?? []){
            const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$cadence$2f$adapters$2f$email$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["deliverQueuedEmailAction"])(service, action);
            if (result.status === 'sent') sent += 1;
            else if (result.status === 'blocked') blocked += 1;
            else if (result.status === 'failed') failed += 1;
        }
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            data: {
                processed: due?.length ?? 0,
                sent,
                blocked,
                failed
            }
        });
    } catch (err) {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: err instanceof Error ? err.message : 'unknown_error'
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__edece45c._.js.map