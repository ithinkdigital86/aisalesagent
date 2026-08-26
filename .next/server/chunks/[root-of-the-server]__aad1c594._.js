module.exports = [
"[externals]/node:fs/promises [external] (node:fs/promises, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:fs/promises", () => require("node:fs/promises"));

module.exports = mod;
}),
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:child_process [external] (node:child_process, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:child_process", () => require("node:child_process"));

module.exports = mod;
}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[externals]/node:readline [external] (node:readline, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:readline", () => require("node:readline"));

module.exports = mod;
}),
"[externals]/node:util [external] (node:util, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:util", () => require("node:util"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/node:stream/promises [external] (node:stream/promises, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:stream/promises", () => require("node:stream/promises"));

module.exports = mod;
}),
"[project]/node_modules/@anthropic-ai/sdk/lib/transform-json-schema.mjs [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "transformJSONSchema",
    ()=>transformJSONSchema
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/internal/utils.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/internal/utils/values.mjs [app-route] (ecmascript)");
;
// Supported string formats
const SUPPORTED_STRING_FORMATS = new Set([
    'date-time',
    'time',
    'date',
    'duration',
    'email',
    'hostname',
    'uri',
    'ipv4',
    'ipv6',
    'uuid'
]);
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
function transformJSONSchema(jsonSchema) {
    const workingCopy = deepClone(jsonSchema);
    return _transformJSONSchema(workingCopy);
}
function _transformJSONSchema(jsonSchema) {
    const strictSchema = {};
    const ref = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, '$ref');
    if (ref !== undefined) {
        strictSchema['$ref'] = ref;
        return strictSchema;
    }
    const defs = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, '$defs');
    if (defs !== undefined) {
        const strictDefs = {};
        strictSchema['$defs'] = strictDefs;
        for (const [name, defSchema] of Object.entries(defs)){
            strictDefs[name] = _transformJSONSchema(defSchema);
        }
    }
    const type = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'type');
    const anyOf = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'anyOf');
    const oneOf = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'oneOf');
    const allOf = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'allOf');
    if (Array.isArray(anyOf)) {
        strictSchema['anyOf'] = anyOf.map((variant)=>_transformJSONSchema(variant));
    } else if (Array.isArray(oneOf)) {
        strictSchema['anyOf'] = oneOf.map((variant)=>_transformJSONSchema(variant));
    } else if (Array.isArray(allOf)) {
        strictSchema['allOf'] = allOf.map((entry)=>_transformJSONSchema(entry));
    } else {
        if (type === undefined) {
            throw new Error('JSON schema must have a type defined if anyOf/oneOf/allOf are not used');
        }
        strictSchema['type'] = type;
    }
    const description = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'description');
    if (description !== undefined) {
        strictSchema['description'] = description;
    }
    const title = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'title');
    if (title !== undefined) {
        strictSchema['title'] = title;
    }
    if (type === 'object') {
        const properties = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'properties') || {};
        strictSchema['properties'] = Object.fromEntries(Object.entries(properties).map(([key, propSchema])=>[
                key,
                _transformJSONSchema(propSchema)
            ]));
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'additionalProperties');
        strictSchema['additionalProperties'] = false;
        const required = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'required');
        if (required !== undefined) {
            strictSchema['required'] = required;
        }
    } else if (type === 'string') {
        const format = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'format');
        if (format !== undefined && SUPPORTED_STRING_FORMATS.has(format)) {
            strictSchema['format'] = format;
        } else if (format !== undefined) {
            jsonSchema['format'] = format;
        }
    } else if (type === 'array') {
        const items = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'items');
        if (items !== undefined) {
            strictSchema['items'] = _transformJSONSchema(items);
        }
        const minItems = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$values$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["pop"])(jsonSchema, 'minItems');
        if (minItems !== undefined && (minItems === 0 || minItems === 1)) {
            strictSchema['minItems'] = minItems;
        } else if (minItems !== undefined) {
            jsonSchema['minItems'] = minItems;
        }
    }
    if (Object.keys(jsonSchema).length > 0) {
        const existingDescription = strictSchema['description'];
        strictSchema['description'] = (existingDescription ? existingDescription + '\n\n' : '') + '{' + Object.entries(jsonSchema).map(([key, value])=>`${key}: ${JSON.stringify(value)}`).join(', ') + '}';
    }
    return strictSchema;
} //# sourceMappingURL=transform-json-schema.mjs.map
}),
"[project]/node_modules/@anthropic-ai/sdk/helpers/beta/json-schema.mjs [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "betaJSONSchemaOutputFormat",
    ()=>betaJSONSchemaOutputFormat,
    "betaTool",
    ()=>betaTool
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/core/error.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$transform$2d$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/lib/transform-json-schema.mjs [app-route] (ecmascript)");
;
;
function betaTool(options) {
    if (options.inputSchema.type !== 'object') {
        throw new Error(`JSON schema for tool "${options.name}" must be an object, but got ${options.inputSchema.type}`);
    }
    return {
        type: 'custom',
        name: options.name,
        input_schema: options.inputSchema,
        description: options.description,
        run: options.run,
        parse: (content)=>content,
        ...options.close ? {
            close: options.close
        } : {}
    };
}
function betaJSONSchemaOutputFormat(jsonSchema, options) {
    if (jsonSchema.type !== 'object') {
        throw new Error(`JSON schema for tool must be an object, but got ${jsonSchema.type}`);
    }
    const transform = options?.transform ?? true;
    if (transform) {
        // todo: doing this is arguably necessary, but it does change the schema the user passed in
        // so I'm not sure how we should handle that
        jsonSchema = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$transform$2d$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["transformJSONSchema"])(jsonSchema);
    }
    return {
        type: 'json_schema',
        schema: {
            ...jsonSchema
        },
        parse: (content)=>{
            try {
                return JSON.parse(content);
            } catch (error) {
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"](`Failed to parse structured output: ${error}`);
            }
        }
    };
} //# sourceMappingURL=json-schema.mjs.map
}),
"[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/fs-util.mjs [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Shared, Node-only filesystem helpers for the agent toolset's file tools:
 * path confinement (symlink-aware), an atomic write, and language-independent
 * error messages. Kept out of `node.ts` so the tool implementations stay focused
 * and these helpers can be reused by every file tool.
 */ __turbopack_context__.s([
    "DIR_CREATE_MODE",
    ()=>DIR_CREATE_MODE,
    "FILE_CREATE_MODE",
    ()=>FILE_CREATE_MODE,
    "atomicWriteFile",
    ()=>atomicWriteFile,
    "canonicalize",
    ()=>canonicalize,
    "confineToRoot",
    ()=>confineToRoot,
    "fsErrorMessage",
    ()=>fsErrorMessage
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs/promises [external] (node:fs/promises, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/lib/tools/ToolError.mjs [app-route] (ecmascript)");
;
;
;
;
const DIR_CREATE_MODE = 0o755;
const FILE_CREATE_MODE = 0o644;
/** `realpath` `p`, or return `p` unchanged when it cannot be resolved. */ async function realpathOrSelf(p) {
    try {
        return await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["realpath"](p);
    } catch  {
        return p;
    }
}
async function canonicalize(abs) {
    const tail = [];
    let prefix = abs;
    let hops = 0;
    for(;;){
        let real;
        try {
            real = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["realpath"](prefix);
        } catch  {
            let isLink = false;
            try {
                isLink = (await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["lstat"](prefix)).isSymbolicLink();
            } catch  {
            /* prefix truly doesn't exist (ENOENT) — fall through and walk up */ }
            if (isLink) {
                // Resolve the symlink ourselves and retry; `tail` (the part below it)
                // still applies to the link's target. The hop cap matches Linux
                // MAXSYMLINKS — the same threshold at which `realpath` itself would
                // have returned ELOOP — so a cycle of unresolvable links terminates.
                if (++hops > 40) {
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`path ${JSON.stringify(abs)} has too many levels of symbolic links`);
                }
                prefix = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"](prefix), await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["readlink"](prefix));
                continue;
            }
            const parent = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"](prefix);
            if (parent === prefix) return abs; // walked past the FS root without a hit
            tail.push(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["basename"](prefix));
            prefix = parent;
            continue;
        }
        return tail.length ? __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](real, ...tail.reverse()) : real;
    }
}
async function confineToRoot(root, p, opts) {
    const allowOutside = opts?.allowOutside ?? false;
    const realRoot = await realpathOrSelf(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](root));
    const abs = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](realRoot, p);
    if (allowOutside) return abs;
    const real = await canonicalize(abs);
    if (real !== realRoot && !real.startsWith(realRoot + __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["sep"])) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`path ${JSON.stringify(p)} escapes workdir`);
    }
    return real;
}
async function atomicWriteFile(targetPath, content) {
    const dir = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"](targetPath);
    const tempPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](dir, `.tmp-${process.pid}-${(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomUUID"])()}`);
    let handle;
    try {
        handle = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["open"](tempPath, 'wx', FILE_CREATE_MODE);
        await handle.writeFile(content, 'utf-8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["rename"](tempPath, targetPath);
    } catch (err) {
        if (handle) await handle.close().catch(()=>{});
        await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["unlink"](tempPath).catch(()=>{});
        throw err;
    }
}
function fsErrorMessage(err, file) {
    const code = err?.code;
    switch(code){
        case 'ENOENT':
            return `${file}: no such file or directory`;
        case 'EACCES':
        case 'EPERM':
            return `${file}: permission denied`;
        case 'ENOTDIR':
            return `${file}: not a directory`;
        case 'EISDIR':
            return `${file}: is a directory`;
        case 'ELOOP':
            return `${file}: too many levels of symbolic links`;
        case 'ENAMETOOLONG':
            return `${file}: file name too long`;
        case 'ENOSPC':
            return `${file}: no space left on device`;
        case 'EMFILE':
        case 'ENFILE':
            return `${file}: too many open files`;
        default:
            return `${file}: ${err instanceof Error ? err.message : String(err)}`;
    }
} //# sourceMappingURL=fs-util.mjs.map
}),
"[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/skills.mjs [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Node-only skill plumbing for the agent toolset: downloading a session
 * agent's skills into the workdir and extracting the archives. Kept in its own
 * file because it is a distinct concern from the tool implementations in
 * `node.ts` — distinct enough, and large enough, to review on its own.
 */ __turbopack_context__.s([
    "extractSkillArchive",
    ()=>extractSkillArchive,
    "resolveSkillVersion",
    ()=>resolveSkillVersion,
    "setupSkills",
    ()=>setupSkills
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs/promises [external] (node:fs/promises, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:child_process [external] (node:child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$util__$5b$external$5d$__$28$node$3a$util$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:util [external] (node:util, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$stream__$5b$external$5d$__$28$node$3a$stream$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:stream [external] (node:stream, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$stream$2f$promises__$5b$external$5d$__$28$node$3a$stream$2f$promises$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:stream/promises [external] (node:stream/promises, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/core/error.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$log$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/internal/utils/log.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/fs-util.mjs [app-route] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
const execFileAsync = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$util__$5b$external$5d$__$28$node$3a$util$2c$__cjs$29$__["promisify"])(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__["execFile"]);
async function setupSkills(ctx) {
    const { client, sessionId } = ctx;
    if (!client || !sessionId) return async ()=>{};
    const log = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$log$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["loggerFor"])(client);
    const session = await client.beta.sessions.retrieve(sessionId);
    const skillsRoot = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](ctx.workdir, 'skills');
    const created = [];
    for (const skill of session.agent.skills){
        try {
            const versionId = await resolveSkillVersion(client, skill.skill_id, skill.version);
            const version = await client.beta.skills.versions.retrieve(versionId, {
                skill_id: skill.skill_id
            });
            // The directory is the skill's name, reduced to a single safe path
            // component so a hostile name can't escape `skillsRoot`.
            let dirname = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["basename"](version.name.trim());
            if (dirname === '' || dirname === '.' || dirname === '..') dirname = skill.skill_id;
            const dest = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](skillsRoot, dirname);
            if (dest !== skillsRoot && !dest.startsWith(skillsRoot + __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["sep"])) {
                log.warn('skill name escapes the skills dir; skipping', {
                    component: 'agent-tool-context',
                    name: version.name
                });
                continue;
            }
            const resp = await client.beta.skills.versions.download(versionId, {
                skill_id: skill.skill_id
            });
            await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["rm"](dest, {
                recursive: true,
                force: true
            });
            await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["mkdir"](dest, {
                recursive: true,
                mode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DIR_CREATE_MODE"]
            });
            created.push(dest);
            await extractSkillArchive(resp, dest);
            log.info('downloaded skill', {
                component: 'agent-tool-context',
                skill_id: skill.skill_id,
                version: versionId,
                dest
            });
        } catch (e) {
            log.warn('failed to download skill', {
                component: 'agent-tool-context',
                skill_id: skill.skill_id,
                error: String(e)
            });
        }
    }
    return async ()=>{
        for (const dest of created){
            await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["rm"](dest, {
                recursive: true,
                force: true
            }).catch((e)=>{
                log.warn('failed to clean up skill', {
                    component: 'agent-tool-context',
                    dest,
                    error: String(e)
                });
            });
        }
    };
}
async function resolveSkillVersion(client, skillId, version) {
    if (/^\d+$/.test(version)) return version;
    let newest;
    for await (const v of client.beta.skills.versions.list(skillId)){
        if (/^\d+$/.test(v.version) && (newest === undefined || BigInt(v.version) > BigInt(newest))) {
            newest = v.version;
        }
    }
    if (newest === undefined) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"](`skill ${JSON.stringify(skillId)} has no concrete version to resolve ${JSON.stringify(version)} against`);
    }
    return newest;
}
/** Reject archive members that are absolute or contain a `..` component. */ function assertSafeMemberNames(names) {
    for (const raw of names.split('\n')){
        const entry = raw.trim();
        if (!entry) continue;
        if (__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["isAbsolute"](entry) || entry.split(/[\\/]/).includes('..')) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"](`refusing to extract unsafe archive member: ${entry}`);
        }
    }
}
/**
 * Reject archives that contain anything other than regular files and
 * directories. The type char is the first byte of each `ls`-style line emitted
 * by `tar -tvf` / `unzip -Z`: `-` file, `d` dir, `l` symlink, `h` hardlink,
 * `b`/`c` device, `p` fifo, `s` socket. A symlink/hardlink member is how an
 * archive escapes its extraction dir even when no name contains `..`.
 */ function assertNoSpecialMembers(verboseListing) {
    for (const line of verboseListing.split('\n')){
        const type = line.trimStart()[0];
        if (type === 'l' || type === 'h' || type === 'b' || type === 'c' || type === 'p' || type === 's') {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"]('refusing to extract archive with symlink/hardlink/device member');
        }
    }
}
/**
 * Run an archive CLI (`unzip` for zip archives, `tar` for everything else),
 * returning its stdout. Both binaries must be on `PATH`; a missing one would
 * otherwise surface as an opaque `ENOENT` spawn failure, so it is turned into a
 * clear, specific error naming the missing command.
 */ async function runArchiveTool(cmd, args) {
    try {
        const { stdout } = await execFileAsync(cmd, args);
        return stdout;
    } catch (e) {
        if (e != null && typeof e === 'object' && e.code === 'ENOENT') {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"](`skill extraction requires the \`${cmd}\` command, but it was not found on PATH`);
        }
        throw e;
    }
}
/**
 * The single top-level directory shared by every entry in a newline-separated
 * archive listing, or `''` if entries don't all live under one common
 * directory. Skill bundles are packaged wrapped in one directory named after
 * the skill (e.g. `pdf/SKILL.md`, `pdf/scripts/...`); the extractor strips it
 * so contents land directly in the skill's dir instead of a redundant nested
 * `<skill>/<skill>/` level. A flat or multi-root archive yields `''`.
 */ function archiveTopDir(listing) {
    let top;
    let nested = false;
    for (const raw of listing.split('\n')){
        // Drop `.` / empty segments so a `./pdf/...`-style listing (e.g. from
        // `tar -C dir .`) is treated the same as `pdf/...`.
        const parts = raw.trim().split('/').filter((p)=>p !== '' && p !== '.');
        if (parts.length === 0) continue;
        const first = parts[0];
        if (top === undefined) top = first;
        else if (first !== top) return '';
        if (parts.length > 1) nested = true;
    }
    return top !== undefined && nested ? top : '';
}
async function extractSkillArchive(resp, dest) {
    const tmp = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](dest, `.skill-archive-${process.pid}-${Date.now()}`);
    if (!resp.body) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"]('skill download response had no body');
    }
    await (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$stream$2f$promises__$5b$external$5d$__$28$node$3a$stream$2f$promises$2c$__cjs$29$__["pipeline"])(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$stream__$5b$external$5d$__$28$node$3a$stream$2c$__cjs$29$__["Readable"].fromWeb(resp.body), __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["createWriteStream"](tmp));
    const stage = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"](dest), `.skill-stage-${process.pid}-${Date.now()}`);
    try {
        // Sniff the first bytes: zip archives start with "PK\x03\x04"; treat
        // anything else as a tar.* archive (`tar -xf` autodetects gzip/bzip2/xz).
        const head = await readHead(tmp, 4);
        const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
        const archiveCmd = isZip ? 'unzip' : 'tar';
        // List first, validate, then extract — `tar`/`unzip` will happily write a
        // `../` member (or follow a symlink member) outside `-C`/`-d` otherwise.
        const listing = await runArchiveTool(archiveCmd, isZip ? [
            '-Z1',
            tmp
        ] : [
            '-tf',
            tmp
        ]);
        assertSafeMemberNames(listing);
        assertNoSpecialMembers(await runArchiveTool(archiveCmd, isZip ? [
            '-Z',
            tmp
        ] : [
            '-tvf',
            tmp
        ]));
        const top = archiveTopDir(listing);
        await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["mkdir"](stage, {
            recursive: true,
            mode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DIR_CREATE_MODE"]
        });
        await runArchiveTool(archiveCmd, isZip ? [
            '-oq',
            tmp,
            '-d',
            stage
        ] : [
            '-xf',
            tmp,
            '-C',
            stage
        ]);
        // Promote the wrapper's contents (or the staged tree itself, if the
        // archive wasn't wrapped) into the already-created empty `dest`. `stage`
        // is a sibling of `dest`, so each rename stays on one filesystem.
        const srcRoot = top ? __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](stage, top) : stage;
        for (const entry of (await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["readdir"](srcRoot))){
            await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["rename"](__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](srcRoot, entry), __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](dest, entry));
        }
    } finally{
        await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["rm"](tmp, {
            force: true
        });
        await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["rm"](stage, {
            recursive: true,
            force: true
        });
    }
}
/** Read the first `n` bytes of `file`. */ async function readHead(file, n) {
    const handle = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["open"](file, 'r');
    try {
        const buf = Buffer.alloc(n);
        const { bytesRead } = await handle.read(buf, 0, n, 0);
        return buf.subarray(0, bytesRead);
    } finally{
        await handle.close();
    }
} //# sourceMappingURL=skills.mjs.map
}),
"[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/node.mjs [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

/**
 * Node implementation of the `agent_toolset_20260401` tools — `bash`, `read`,
 * `write`, `edit`, `glob`, `grep` — plus the workdir/skills
 * {@link AgentToolContext}.
 *
 * This mirrors `@anthropic-ai/sdk/tools/memory/node`: it is the explicit,
 * Node-only entry point for these implementations. Importing it pulls in
 * `node:child_process`, `node:fs`, etc., so it is kept separate from the rest of
 * the SDK — depending on it is an opt-in.
 *
 * **Node 22+ is required** for this module: the `glob` tool uses the native
 * `fs.glob`, added in Node 22. The rest of the SDK still supports Node 18+; only
 * the agent toolset has this requirement.
 *
 * The result of {@link betaAgentToolset20260401} is a plain `BetaRunnableTool[]`;
 * hand it to any tool runner — `client.beta.messages.toolRunner({ …, tools })`
 * for the Messages API, or `client.beta.sessions.events.toolRunner({ …, tools })`
 * for a managed-agents session:
 *
 * ```ts
 * import { betaAgentToolset20260401 } from '@anthropic-ai/sdk/tools/agent-toolset/node';
 *
 * const tools = betaAgentToolset20260401({ workdir: '/work' });
 * const tools2 = betaAgentToolset20260401({ workdir: '/work' }).filter((t) => t.name !== 'bash');
 * ```
 *
 * Trust model: the file tools confine to `workdir` (symlink-aware) and are safe
 * without a sandbox; `bash` is unrestricted and should run inside one. See
 * {@link AgentToolContext}.
 */ __turbopack_context__.s([
    "BashSession",
    ()=>BashSession,
    "betaAgentToolset20260401",
    ()=>betaAgentToolset20260401,
    "betaBashTool",
    ()=>betaBashTool,
    "betaEditTool",
    ()=>betaEditTool,
    "betaGlobTool",
    ()=>betaGlobTool,
    "betaGrepTool",
    ()=>betaGrepTool,
    "betaReadTool",
    ()=>betaReadTool,
    "betaWriteTool",
    ()=>betaWriteTool,
    "resolvePath",
    ()=>resolvePath
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/internal/tslib.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs/promises [external] (node:fs/promises, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:child_process [external] (node:child_process, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$readline__$5b$external$5d$__$28$node$3a$readline$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:readline [external] (node:readline, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/core/error.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/lib/tools/ToolError.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/helpers/beta/json-schema.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$promise$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/internal/utils/promise.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/fs-util.mjs [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$skills$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/skills.mjs [app-route] (ecmascript)");
var _BashSession_instances, _BashSession_proc, _BashSession_buf, _BashSession_truncated, _BashSession_closed, _BashSession_waiting, _BashSession_append;
;
;
;
;
;
;
;
;
;
;
;
;
;
const BASH_OUTPUT_LIMIT = 100 * 1024;
const BASH_DEFAULT_TIMEOUT_MS = 120000;
// Default size cap for the read/edit tools (both load the whole file into
// memory) when AgentToolContext.maxFileBytes is unset. The reject-vs-truncate
// behaviour remains a separate question pending CMA validation.
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const GREP_OUTPUT_LIMIT = 100 * 1024;
const GREP_MAX_LINE_LENGTH = 2000;
const GLOB_RESULT_LIMIT = 200;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const fsGlob = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["glob"];
function resolveMaxBytes(configured) {
    return configured === undefined ? DEFAULT_MAX_FILE_BYTES : configured;
}
function betaAgentToolset20260401(ctx) {
    return [
        betaBashTool(ctx),
        betaReadTool(ctx),
        betaWriteTool(ctx),
        betaEditTool(ctx),
        betaGlobTool(ctx),
        betaGrepTool(ctx)
    ];
}
function resolvePath(ctx, p) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["confineToRoot"])(ctx.workdir, p, {
        allowOutside: ctx.unrestrictedPaths ?? false
    });
}
// ---- bash ----------------------------------------------------------------
/**
 * Build the environment for the spawned bash shell. The runner process holds
 * Anthropic credentials in `ANTHROPIC_*` env vars — the API key, the auth token,
 * and the per-work session token among them. `bash` runs an unrestricted shell,
 * so any command the agent runs could read those straight out of `process.env`;
 * strip the whole `ANTHROPIC_*` namespace from the child's environment.
 * Everything else (PATH, HOME, locale, …) is passed through unchanged.
 *
 * Passing an explicit `env` to {@link AgentToolContext} does NOT add to this
 * default — it FULLY REPLACES it. The provided mapping becomes the entire bash
 * environment verbatim; nothing here is merged in, so callers who want the
 * scrubbed process environment plus extras must build that mapping themselves.
 */ function scrubbedShellEnv() {
    const env = {};
    for (const [key, value] of Object.entries(process.env)){
        if (key.startsWith('ANTHROPIC_')) continue;
        env[key] = value;
    }
    return env;
}
class BashSession {
    constructor(dir, env = scrubbedShellEnv()){
        _BashSession_instances.add(this);
        _BashSession_proc.set(this, void 0);
        _BashSession_buf.set(this, '');
        _BashSession_truncated.set(this, false);
        _BashSession_closed.set(this, false);
        // While a command is in flight, the resolver to fire once its sentinel lands
        // in `#buf` (or once the shell dies). Event-driven: no polling loop.
        _BashSession_waiting.set(this, null);
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_proc, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__["spawn"]('/bin/bash', [
            '--noprofile',
            '--norc'
        ], {
            cwd: dir,
            // `env` is the full base environment (the scrubbed process env by
            // default, or the verbatim replacement from `AgentToolContext.env`).
            // PS1/PS2/TERM are shell-control settings BashSession always applies so
            // the pipe-based sentinel exec parsing works — not part of the
            // user-facing environment.
            env: {
                ...env,
                PS1: '',
                PS2: '',
                TERM: 'dumb'
            },
            stdio: [
                'pipe',
                'pipe',
                'pipe'
            ],
            detached: true
        }), "f");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stdout.setEncoding('utf8');
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stderr.setEncoding('utf8');
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stdout.on('data', (d)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_instances, "m", _BashSession_append).call(this, d));
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stderr.on('data', (d)=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_instances, "m", _BashSession_append).call(this, d));
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").once('close', ()=>{
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_closed, true, "f");
            // Wake any in-flight exec so it fails fast instead of waiting for its deadline.
            const w = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_waiting, "f");
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_waiting, null, "f");
            w?.resolve();
        });
    }
    /** Whether the underlying shell process has exited. */ get closed() {
        return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_closed, "f");
    }
    async exec(command, opts = {}) {
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_closed, "f")) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"]('bash session terminated');
        }
        const timeoutMs = opts.timeoutMs ?? BASH_DEFAULT_TIMEOUT_MS;
        const signal = opts.signal;
        if (signal?.aborted) {
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"]('bash command aborted');
        }
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_buf, '', "f");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_truncated, false, "f");
        // Per-call nonce so a command that prints a fixed marker can't spoof the
        // exit-code framing. The `''` split keeps the literal out of what we write
        // to stdin — only the shell's printf reassembles it.
        const sentinel = `__ANT_CMD_${__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomUUID"]()}_DONE__`;
        const sentinelSplit = `${sentinel.slice(0, 8)}''${sentinel.slice(8)}`;
        // </dev/null: a stdin-reading command (`cat`, `read`) gets EOF instead of
        // blocking on the shared pipe until the timeout.
        const wrapped = `{ ${command}\n} </dev/null 2>&1; printf '\\n${sentinelSplit}%d\\n' $?\n`;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stdin.write(wrapped);
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").indexOf(sentinel) < 0) {
            // Park until the sentinel lands, the deadline passes, the caller aborts,
            // or the shell dies — whichever comes first. `#append` (and the `close`
            // handler) resolve `sentinelSeen`; the deadline / abort reject.
            const { promise: sentinelSeen, resolve } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$promise$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["promiseWithResolvers"])();
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_waiting, {
                sentinel,
                resolve
            }, "f");
            let timer;
            let onAbort;
            try {
                await Promise.race([
                    sentinelSeen,
                    new Promise((_, reject)=>{
                        timer = setTimeout(()=>reject(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"](`bash command timed out after ${timeoutMs}ms`)), timeoutMs);
                    }),
                    new Promise((_, reject)=>{
                        if (!signal) return;
                        onAbort = ()=>reject(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"]('bash command aborted'));
                        signal.addEventListener('abort', onAbort, {
                            once: true
                        });
                    })
                ]);
            } finally{
                if (timer) clearTimeout(timer);
                if (onAbort && signal) signal.removeEventListener('abort', onAbort);
                (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_waiting, null, "f");
            }
        }
        const idx = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").indexOf(sentinel);
        if (idx < 0) {
            // The shell closed (or was killed) before emitting the sentinel.
            throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$core$2f$error$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["AnthropicError"]('bash session terminated');
        }
        const tail = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").slice(idx + sentinel.length);
        const m = tail.match(/^(-?\d+)/);
        const exitCode = m ? parseInt(m[1], 10) : -1;
        let out = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").slice(0, idx).replace(ANSI_RE, '').replace(/\n+$/, '');
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_truncated, "f")) {
            out = `[output truncated]\n${out}`;
        }
        return {
            output: out,
            exitCode
        };
    }
    close() {
        if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_closed, "f")) return;
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_closed, true, "f");
        const w = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_waiting, "f");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_waiting, null, "f");
        w?.resolve();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stdout.destroy();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stderr.destroy();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").stdin.destroy();
        try {
            // Negative PID targets the process group so foreground jobs (e.g. a
            // hung sleep) die with the shell.
            process.kill(-(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").pid, 'SIGKILL');
        } catch  {
            (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").kill('SIGKILL');
        }
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_proc, "f").unref();
    }
}
_BashSession_proc = new WeakMap(), _BashSession_buf = new WeakMap(), _BashSession_truncated = new WeakMap(), _BashSession_closed = new WeakMap(), _BashSession_waiting = new WeakMap(), _BashSession_instances = new WeakSet(), _BashSession_append = function _BashSession_append(d) {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_buf, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f") + d, "f");
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").length > BASH_OUTPUT_LIMIT) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_buf, (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").slice((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").length - BASH_OUTPUT_LIMIT), "f");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_truncated, true, "f");
    }
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_waiting, "f") && (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_buf, "f").indexOf((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_waiting, "f").sentinel) >= 0) {
        const w = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldGet"])(this, _BashSession_waiting, "f");
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$tslib$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["__classPrivateFieldSet"])(this, _BashSession_waiting, null, "f");
        w.resolve();
    }
};
function betaBashTool(ctx) {
    let session;
    // Concurrent run() callers chain onto this promise so writes to the shared
    // shell's stdin can't interleave (which would corrupt the sentinel-match
    // exit-code parsing in BashSession.exec). Each call replaces `tail` with a
    // promise that resolves only after its own exec settles.
    let tail = Promise.resolve();
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["betaTool"])({
        name: 'bash',
        description: 'Run a bash command in a persistent shell. State (cwd, env vars) persists across calls.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The command to run'
                },
                restart: {
                    type: 'boolean',
                    description: 'Restart the persistent shell before running'
                },
                timeout_ms: {
                    type: 'integer',
                    description: 'Per-call timeout in milliseconds'
                }
            }
        },
        run: async ({ command, restart, timeout_ms }, context)=>{
            const prev = tail;
            const gate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$internal$2f$utils$2f$promise$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["promiseWithResolvers"])();
            tail = gate.promise;
            // Swallow prior rejections — earlier callers got their own error path;
            // we just need to wait for the shell to be free.
            try {
                await prev;
            } catch  {
            // ignore
            }
            try {
                if (restart) {
                    session?.close();
                    session = undefined;
                }
                if (!command) {
                    if (restart) return 'bash session restarted';
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('bash: command is required');
                }
                session ?? (session = new BashSession(ctx.workdir, ctx.env));
                try {
                    const { output, exitCode } = await session.exec(command, {
                        timeoutMs: timeout_ms ?? BASH_DEFAULT_TIMEOUT_MS,
                        signal: context?.signal
                    });
                    if (exitCode !== 0) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](output || `exit ${exitCode}`);
                    return output;
                } catch (e) {
                    if (e instanceof __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]) throw e;
                    // Timeout, abort, or terminated: the still-running command will emit
                    // a stale sentinel, so discard this session and let the next call
                    // start fresh.
                    session.close();
                    session = undefined;
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`bash: ${e instanceof Error ? e.message : String(e)}`);
                }
            } finally{
                gate.resolve();
            }
        },
        close: ()=>{
            session?.close();
            session = undefined;
        }
    });
}
function betaReadTool(ctx) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["betaTool"])({
        name: 'read',
        description: 'Read a UTF-8 text file relative to the workdir.',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string'
                },
                view_range: {
                    type: 'array',
                    items: {
                        type: 'integer'
                    },
                    description: '[start_line, end_line] 1-indexed inclusive'
                }
            },
            required: [
                'file_path'
            ]
        },
        run: async ({ file_path, view_range })=>{
            if (!file_path) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('read: file_path is required');
            const abs = await resolvePath(ctx, file_path);
            let data;
            try {
                // stat() before any open(): the size cap stops a multi-GB file from
                // OOM'ing the runner, and isFile() rejects FIFOs/devices/dirs without
                // opening them (open() on an unconnected FIFO blocks indefinitely).
                const st = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["stat"](abs);
                if (!st.isFile()) {
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`read: ${file_path} is not a regular file`);
                }
                const limit = resolveMaxBytes(ctx.maxFileBytes);
                if (limit !== null && st.size > limit) {
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`read: ${file_path} is ${st.size} bytes, exceeds ${limit}-byte limit. ` + 'Use bash (head/tail/sed) to read a slice.');
                }
                data = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["readFile"](abs, 'utf8');
            } catch (e) {
                if (e instanceof __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]) throw e;
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`read: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fsErrorMessage"])(e, file_path)}`);
            }
            if (!view_range) return data;
            if (view_range.length !== 2) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('read: view_range must be [start_line, end_line]');
            const [startLine, endLine] = view_range;
            const lines = data.split('\n');
            const start = Math.max(0, startLine - 1);
            const end = endLine > 0 ? endLine : lines.length;
            return lines.slice(start, end).join('\n');
        }
    });
}
function betaWriteTool(ctx) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["betaTool"])({
        name: 'write',
        description: 'Write a UTF-8 text file relative to the workdir, creating parent directories as needed.',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string'
                },
                content: {
                    type: 'string'
                }
            },
            required: [
                'file_path',
                'content'
            ]
        },
        run: async ({ file_path, content })=>{
            if (!file_path) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('write: file_path is required');
            const abs = await resolvePath(ctx, file_path);
            try {
                await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["mkdir"](__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["dirname"](abs), {
                    recursive: true,
                    mode: __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["DIR_CREATE_MODE"]
                });
                await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["atomicWriteFile"])(abs, content ?? '');
            } catch (e) {
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`write: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fsErrorMessage"])(e, file_path)}`);
            }
            return `wrote ${Buffer.byteLength(content ?? '')} bytes to ${file_path}`;
        }
    });
}
function betaEditTool(ctx) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["betaTool"])({
        name: 'edit',
        description: 'Replace old_string with new_string in a file. old_string must be unique unless replace_all.',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string'
                },
                old_string: {
                    type: 'string'
                },
                new_string: {
                    type: 'string'
                },
                replace_all: {
                    type: 'boolean'
                }
            },
            required: [
                'file_path',
                'old_string',
                'new_string'
            ]
        },
        run: async ({ file_path, old_string, new_string, replace_all })=>{
            if (!file_path) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('edit: file_path is required');
            if (!old_string) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('edit: old_string is required');
            const abs = await resolvePath(ctx, file_path);
            let data;
            try {
                // stat() before any open() — same guard as `read`: the size cap stops a
                // multi-GB file from OOM'ing the runner, and isFile() rejects
                // FIFOs/devices/dirs without opening them (open() on an unconnected FIFO
                // blocks indefinitely). The edit path is model-controlled, so it needs
                // the same bound `read` already has.
                const st = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["stat"](abs);
                if (!st.isFile()) {
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`edit: ${file_path} is not a regular file`);
                }
                const limit = resolveMaxBytes(ctx.maxFileBytes);
                if (limit !== null && st.size > limit) {
                    throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`edit: ${file_path} is ${st.size} bytes, exceeds ${limit}-byte limit. ` + 'Use bash (sed/awk) to edit a large file.');
                }
                data = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["readFile"](abs, 'utf8');
            } catch (e) {
                if (e instanceof __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]) throw e;
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`edit: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fsErrorMessage"])(e, file_path)}`);
            }
            const count = data.split(old_string).length - 1;
            if (count === 0) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`edit: old_string not found in ${file_path}`);
            let updated;
            if (replace_all) {
                updated = data.split(old_string).join(new_string);
            } else {
                if (count > 1) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`edit: old_string appears ${count} times in ${file_path} (must be unique)`);
                // Callback form so `$&`/`$1`/`` $` `` in new_string are inserted
                // literally instead of expanded as replacement patterns.
                updated = data.replace(old_string, ()=>new_string);
            }
            try {
                await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["atomicWriteFile"])(abs, updated);
            } catch (e) {
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`edit: write: ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$fs$2d$util$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["fsErrorMessage"])(e, file_path)}`);
            }
            return `edited ${file_path} (${replace_all ? count : 1} replacement(s))`;
        }
    });
}
function betaGlobTool(ctx) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["betaTool"])({
        name: 'glob',
        description: 'Match files under the workdir against a glob pattern. Results are mtime-sorted, newest first.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string'
                },
                path: {
                    type: 'string',
                    description: 'Directory to search in. Defaults to the workdir.'
                }
            },
            required: [
                'pattern'
            ]
        },
        run: async ({ pattern, path: searchPath })=>{
            if (!pattern) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('glob: pattern is required');
            let root = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](ctx.workdir);
            let pat = pattern;
            if (__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["isAbsolute"](pattern)) {
                if (!ctx.unrestrictedPaths) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('glob: absolute pattern not permitted');
                root = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["parse"](pattern).root;
                pat = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["relative"](root, pattern);
            } else if (searchPath) {
                root = await resolvePath(ctx, searchPath);
            }
            // A `..` in the *pattern itself* (e.g. `../../*`) walks `fs.glob` out of
            // the search root — this is separate from the `searchPath` confinement
            // above, which only covers the path argument. Reject it outright when the
            // toolset is confined.
            if (!ctx.unrestrictedPaths && pat.split(/[\\/]/).includes('..')) {
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('glob: ".." is not permitted in the pattern');
            }
            // Compare canonical against canonical: a workdir that is itself a
            // symlink would otherwise falsely reject every realpath'd match below.
            const realRoot = ctx.unrestrictedPaths ? root : await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["realpath"](root).catch(()=>root);
            const matches = [];
            try {
                // Native `fs.glob` (Node 22+). `exclude` prunes the noisy dirs the
                // legacy walker skipped; only regular files are collected.
                for await (const entry of fsGlob(pat, {
                    cwd: root,
                    withFileTypes: true,
                    exclude: (d)=>d.name === '.git' || d.name === 'node_modules'
                })){
                    if (!entry.isFile()) continue;
                    const full = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](entry.parentPath, entry.name);
                    // Drop any match that resolves outside the search root. A pattern
                    // that *names* a symlinked directory (the model controls the
                    // pattern, and the bash tool in the same session can plant the
                    // link) makes `fs.glob` descend through it and report entries with
                    // the raw parent path, so a lexical check on `full` alone would
                    // pass `root/link_out/secret` even though it lives outside the
                    // jail. Resolve-failure (ELOOP, EACCES, a racing unlink) is a deny.
                    if (!ctx.unrestrictedPaths) {
                        let real;
                        try {
                            real = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["realpath"](full);
                        } catch  {
                            continue;
                        }
                        if (!isWithin(realRoot, real)) continue;
                    }
                    let mtime = 0;
                    try {
                        mtime = (await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["stat"](full)).mtimeMs;
                    } catch  {
                    // unreadable — keep it in the list with mtime 0
                    }
                    matches.push({
                        path: full,
                        mtime
                    });
                }
            } catch (e) {
                throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`glob: ${e instanceof Error ? e.message : String(e)}`);
            }
            if (matches.length === 0) return 'no matches';
            matches.sort((a, b)=>b.mtime - a.mtime);
            return matches.slice(0, GLOB_RESULT_LIMIT).map((m)=>m.path).join('\n');
        }
    });
}
function betaGrepTool(ctx) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$helpers$2f$beta$2f$json$2d$schema$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["betaTool"])({
        name: 'grep',
        description: 'Search file contents for a regex. Uses ripgrep if available, otherwise a built-in walker.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string'
                },
                path: {
                    type: 'string'
                }
            },
            required: [
                'pattern'
            ]
        },
        run: async ({ pattern, path: p }, context)=>{
            if (!pattern) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('grep: pattern is required');
            let searchPath = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["resolve"](ctx.workdir);
            if (p) searchPath = await resolvePath(ctx, p);
            const rg = await findRg();
            return rg ? runRipgrep(rg, pattern, searchPath, context?.signal) : runWalkGrep(pattern, searchPath, context?.signal);
        }
    });
}
function runRipgrep(rg, pattern, searchPath, signal) {
    return new Promise((resolve, reject)=>{
        const proc = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$child_process__$5b$external$5d$__$28$node$3a$child_process$2c$__cjs$29$__["spawn"](rg, [
            '-n',
            '--no-heading',
            '-e',
            pattern,
            '--',
            searchPath
        ], {
            ...signal ? {
                signal
            } : {}
        });
        let out = '';
        let errOut = '';
        let truncated = false;
        proc.stdout.on('data', (d)=>{
            if (truncated) return;
            out += d;
            if (out.length > GREP_OUTPUT_LIMIT) {
                truncated = true;
                out = out.slice(0, GREP_OUTPUT_LIMIT);
                proc.kill('SIGKILL');
            }
        });
        proc.stderr.on('data', (d)=>errOut += d);
        proc.on('close', (code)=>{
            if (signal?.aborted) return reject(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('grep: aborted'));
            if (truncated) return resolve(out + `\n[output truncated at ${GREP_OUTPUT_LIMIT} bytes]`);
            if (code === 0) return resolve(out);
            if (code === 1) return resolve('no matches');
            reject(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`grep: rg failed: ${errOut || `exit ${code}`}`));
        });
        proc.on('error', (e)=>{
            if (signal?.aborted) return reject(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('grep: aborted'));
            reject(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`grep: rg failed: ${e.message}`));
        });
    });
}
async function runWalkGrep(pattern, root, signal) {
    let re;
    try {
        re = new RegExp(pattern);
    } catch (e) {
        throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"](`grep: invalid regex: ${e instanceof Error ? e.message : String(e)}`);
    }
    const hits = [];
    let budget = GREP_OUTPUT_LIMIT;
    const push = (line)=>{
        budget -= line.length + 1;
        if (budget < 0) {
            hits.push(`[output truncated at ${GREP_OUTPUT_LIMIT} bytes]`);
            return false;
        }
        hits.push(line);
        return true;
    };
    const stat = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["stat"](root).catch(()=>null);
    if (stat?.isFile()) {
        await grepFile(root, re, push);
    } else {
        await walk(root, '', (rel)=>grepFile(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](root, rel), re, push), signal);
    }
    if (signal?.aborted) throw new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$lib$2f$tools$2f$ToolError$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ToolError"]('grep: aborted');
    if (hits.length === 0) return 'no matches';
    return hits.join('\n');
}
async function grepFile(file, re, push) {
    const stream = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["createReadStream"](file, {
        encoding: 'utf8'
    });
    const rl = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$readline__$5b$external$5d$__$28$node$3a$readline$2c$__cjs$29$__["createInterface"]({
        input: stream,
        crlfDelay: Infinity
    });
    let i = 0;
    try {
        for await (const line of rl){
            i++;
            // Cap line length: `pattern` is model-supplied and JS regexes backtrack,
            // so a pathological pattern against a very long line is a ReDoS.
            if (line.length > GREP_MAX_LINE_LENGTH) continue;
            if (re.test(line) && !push(`${file}:${i}:${line}`)) return false;
        }
    } catch  {
    // unreadable / binary
    } finally{
        stream.destroy();
    }
    return true;
}
// ---- utils ---------------------------------------------------------------
/** True when `p` is `root` itself or lexically contained within it. */ function isWithin(root, p) {
    const rel = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["relative"](root, p);
    return rel === '' || !rel.startsWith('..' + __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["sep"]) && rel !== '..' && !__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["isAbsolute"](rel);
}
const WALK_MAX_DEPTH = 40;
const WALK_MAX_ENTRIES = 50000;
/**
 * Bounded recursive walk. `fn` may return `false` to abort. Only real
 * directories are descended into and only real files are handed to `fn` —
 * symlinks (and devices/fifos/sockets) are skipped entirely so a symlink inside
 * the root cannot be followed out of it.
 */ async function walk(root, rel, fn, signal) {
    let remaining = WALK_MAX_ENTRIES;
    async function inner(rel, depth) {
        if (depth > WALK_MAX_DEPTH) return true;
        if (signal?.aborted) return false;
        let entries;
        try {
            entries = await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["readdir"](__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](root, rel), {
                withFileTypes: true
            });
        } catch  {
            return true;
        }
        for (const e of entries){
            if (e.name === '.git' || e.name === 'node_modules') continue;
            if (remaining-- <= 0) return false;
            if (signal?.aborted) return false;
            const childRel = rel ? __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](rel, e.name) : e.name;
            if (e.isDirectory()) {
                if (!await inner(childRel, depth + 1)) return false;
            } else if (e.isFile()) {
                if (await fn(childRel) === false) return false;
            }
        // Symlinks, devices, fifos and sockets are intentionally skipped.
        }
        return true;
    }
    await inner(rel, 0);
}
async function findRg() {
    const dirs = (process.env['PATH'] ?? '').split(__TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["delimiter"]);
    for (const d of dirs){
        const candidate = __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"](d, 'rg');
        try {
            await __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs$2f$promises__$5b$external$5d$__$28$node$3a$fs$2f$promises$2c$__cjs$29$__["access"](candidate, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["constants"].X_OK);
            return candidate;
        } catch  {
        // not here
        }
    }
    return null;
} //# sourceMappingURL=node.mjs.map
}),
"[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/node.mjs [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "BashSession",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["BashSession"],
    "betaAgentToolset20260401",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaAgentToolset20260401"],
    "betaBashTool",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaBashTool"],
    "betaEditTool",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaEditTool"],
    "betaGlobTool",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaGlobTool"],
    "betaGrepTool",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaGrepTool"],
    "betaReadTool",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaReadTool"],
    "betaWriteTool",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["betaWriteTool"],
    "extractSkillArchive",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$skills$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["extractSkillArchive"],
    "resolvePath",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["resolvePath"],
    "resolveSkillVersion",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$skills$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["resolveSkillVersion"],
    "setupSkills",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$skills$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__["setupSkills"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$node$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/node.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$anthropic$2d$ai$2f$sdk$2f$tools$2f$agent$2d$toolset$2f$skills$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@anthropic-ai/sdk/tools/agent-toolset/skills.mjs [app-route] (ecmascript)");
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__aad1c594._.js.map