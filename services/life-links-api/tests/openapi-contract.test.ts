import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ATTACHMENT_MIME_TYPES, ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_IMAGE_MAX_BASE64_CHARS,
  ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE, createCanonicalLifeLink, summarizeLifeLink } from "@life-links/core";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;
type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

const HTTP_METHODS: HttpMethod[] = ["get", "post", "patch", "put", "delete"];
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(testDirectory, "../../../contracts/http/openapi.json");
const passwordPath = path.resolve(testDirectory, "../src/password.ts");
const serverPath = path.resolve(testDirectory, "../src/server.ts");
const calendarConnectionRouterPath = path.resolve(testDirectory, "../src/calendar-connections.ts");
const calendarNotificationRouterPath = path.resolve(testDirectory, "../src/calendar-provider-subscriptions.ts");
const storePath = path.resolve(testDirectory, "../src/store.ts");
const webClientPath = path.resolve(testDirectory, "../../../apps/life-links-demo/src/api.ts");
const webControllerPath = path.resolve(testDirectory, "../../../apps/life-links-demo/src/workspace/controller.ts");

const EXPECTED_WEB_CLIENT_OPERATIONS = [
  "POST /api/calendar-providers/microsoft/authorize",
  "POST /api/calendar-providers/google/authorize",
  "GET /api/calendar-authorizations/{authorizationId}/calendars",
  "POST /api/calendar-authorizations/{authorizationId}/complete",
  "DELETE /api/calendar-authorizations/{authorizationId}",
  "GET /api/calendar-connections/{connectionId}/available-calendars",
  "POST /api/calendar-connections/{connectionId}/select",
  "POST /api/calendar-connections/{connectionId}/refresh",
  "GET /api/calendar-providers",
  "GET /api/calendar-connections",
  "GET /api/calendar-connections/{connectionId}/calendars",
  "PATCH /api/calendar-connections/{connectionId}/calendars/{calendarId}",
  "POST /api/calendar-connections/{connectionId}/disconnect",
  "DELETE /api/calendar-connections/{connectionId}",
  "DELETE /api/calendar-connections/{connectionId}/calendars/{calendarId}",
  "GET /api/calendar-clock",
  "GET /api/calendars",
  "POST /api/calendars",
  "GET /api/calendars/{calendarId}",
  "PATCH /api/calendars/{calendarId}",
  "DELETE /api/calendars/{calendarId}",
  "POST /api/calendars/{calendarId}/restore",
  "GET /api/calendar-events",
  "POST /api/calendar-events",
  "GET /api/calendar-events/{eventId}",
  "PATCH /api/calendar-events/{eventId}",
  "DELETE /api/calendar-events/{eventId}",
  "POST /api/calendar-events/{eventId}/restore",
  "GET /api/routine-groups",
  "POST /api/routine-groups",
  "GET /api/routine-groups/{groupId}",
  "PATCH /api/routine-groups/{groupId}",
  "GET /api/routine-activities",
  "POST /api/routine-activities",
  "GET /api/routine-activities/{activityId}",
  "PATCH /api/routine-activities/{activityId}",
  "GET /api/routines",
  "POST /api/routines",
  "GET /api/routines/{routineId}",
  "PATCH /api/routines/{routineId}",
  "GET /api/routines/{routineId}/active-run",
  "POST /api/routines/{routineId}/revisions",
  "GET /api/routines/{routineId}/revisions/{revisionId}",
  "GET /api/routines/{routineId}/schedules",
  "POST /api/routines/{routineId}/schedules",
  "PATCH /api/routine-schedules/{scheduleId}",
  "GET /api/routine-occurrences",
  "POST /api/routine-occurrences/materialize",
  "GET /api/routine-occurrences/{occurrenceId}",
  "POST /api/routines/{routineId}/runs",
  "GET /api/routine-runs/{runId}",
  "PUT /api/routine-runs/{runId}/step-results/{routineStepId}",
  "POST /api/routine-runs/{runId}/finalize",
  "GET /api/routine-sessions",
  "GET /api/routine-sessions/{sessionId}",
  "POST /api/routine-sessions/{sessionId}/amendments",
  "GET /api/life-links/{lifeLinkId}/media/{mediaId}/image",
  "GET /api/life-links/{lifeLinkId}/media/{mediaId}/content",
  "POST /api/life-links/changes/preview",
  "GET /api/life-links/changes/{previewId}",
  "POST /api/life-links/changes/apply",
  "POST /api/collections/changes/preview",
  "GET /api/collections/changes/{previewId}",
  "POST /api/collections/changes/apply",
  "GET /api/change-history",
  "POST /api/change-history/undo",
  "DELETE /api/collections/{collectionId}/members/{lifeLinkId}",
  "DELETE /api/collections/{collectionId}/sections/{sectionId}",
  "DELETE /api/life-links/{lifeLinkId}/qr-binding",
  "GET /api/collections",
  "GET /api/collections/{collectionId}",
  "GET /api/collections/{collectionId}/members",
  "GET /api/life-links/{lifeLinkId}/collection-memberships",
  "PATCH /api/collections/{collectionId}",
  "PATCH /api/collections/{collectionId}/sections/{sectionId}",
  "POST /api/collections",
  "POST /api/collections/{collectionId}/sections",
  "PUT /api/collections/{collectionId}/members/{lifeLinkId}",
  "PUT /api/collections/{collectionId}/members/{lifeLinkId}/sections",
  "PUT /api/life-links/{lifeLinkId}/qr-binding",
  "DELETE /api/life-links/{lifeLinkId}/media/{mediaId}",
  "DELETE /api/links/{qrId}/media/{mediaId}",
  "DELETE /api/agent-connection",
  "GET /api/config",
  "GET /api/life-links",
  "GET /api/life-links/search",
  "GET /api/life-links/{lifeLinkId}",
  "GET /api/links",
  "GET /api/me",
  "GET /api/qr/{qrId}",
  "PATCH /api/life-links/{lifeLinkId}",
  "PATCH /api/life-links/{lifeLinkId}/parent",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/find/scan",
  "POST /api/life-links",
  "POST /api/life-links/{lifeLinkId}/media",
  "POST /api/links/{qrId}/media",
  "POST /api/qr-batches",
  "POST /api/qr/{qrId}/claim",
  "PUT /api/agent-connection"
].sort();

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function objectValue(value: unknown, label: string): JsonObject {
  expect(value, `${label} must be an object`).toBeTruthy();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  expect(typeof value, `${label} must be an object`).toBe("object");
  return value as JsonObject;
}

function parseStrictJson(source: string): JsonObject {
  expect(source.charCodeAt(0), "contract must not contain a byte-order mark").not.toBe(0xfeff);
  const parsed = JSON.parse(source) as unknown;
  assertNoDuplicateObjectKeys(source);
  return objectValue(parsed, "OpenAPI document");
}

function assertNoDuplicateObjectKeys(source: string): void {
  let offset = 0;

  function skipWhitespace(): void {
    while (/\s/.test(source[offset] ?? "")) {
      offset += 1;
    }
  }

  function parseString(): string {
    const start = offset;
    expect(source[offset], `expected JSON string at byte ${offset}`).toBe('"');
    offset += 1;
    let escaped = false;
    while (offset < source.length) {
      const character = source[offset];
      offset += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        return JSON.parse(source.slice(start, offset)) as string;
      }
    }
    throw new Error(`unterminated JSON string at byte ${start}`);
  }

  function parseArray(): void {
    offset += 1;
    skipWhitespace();
    if (source[offset] === "]") {
      offset += 1;
      return;
    }
    while (true) {
      parseValue();
      skipWhitespace();
      if (source[offset] === "]") {
        offset += 1;
        return;
      }
      expect(source[offset], `expected array comma at byte ${offset}`).toBe(",");
      offset += 1;
      skipWhitespace();
    }
  }

  function parseObject(): void {
    offset += 1;
    skipWhitespace();
    if (source[offset] === "}") {
      offset += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      const key = parseString();
      if (keys.has(key)) {
        throw new Error(`duplicate JSON object key ${JSON.stringify(key)} at byte ${offset}`);
      }
      keys.add(key);
      skipWhitespace();
      expect(source[offset], `expected object colon at byte ${offset}`).toBe(":");
      offset += 1;
      parseValue();
      skipWhitespace();
      if (source[offset] === "}") {
        offset += 1;
        return;
      }
      expect(source[offset], `expected object comma at byte ${offset}`).toBe(",");
      offset += 1;
      skipWhitespace();
    }
  }

  function parseValue(): void {
    skipWhitespace();
    const character = source[offset];
    if (character === "{") {
      parseObject();
      return;
    }
    if (character === "[") {
      parseArray();
      return;
    }
    if (character === '"') {
      parseString();
      return;
    }
    const primitive = source
      .slice(offset)
      .match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!primitive) {
      throw new Error(`invalid JSON value at byte ${offset}`);
    }
    offset += primitive.length;
  }

  parseValue();
  skipWhitespace();
  expect(offset, "strict JSON parser must consume the entire contract").toBe(source.length);
}

function resolveLocalRef(document: JsonObject, reference: string): unknown {
  expect(reference.startsWith("#/"), `non-local $ref is forbidden: ${reference}`).toBe(true);
  let value: unknown = document;
  for (const encodedToken of reference.slice(2).split("/")) {
    const token = encodedToken.replace(/~1/g, "/").replace(/~0/g, "~");
    const record = objectValue(value, `parent of ${reference}`);
    expect(Object.prototype.hasOwnProperty.call(record, token), `broken $ref: ${reference}`).toBe(true);
    value = record[token];
  }
  return value;
}

function collectReferences(value: unknown, references: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectReferences(entry, references);
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as JsonObject)) {
      if (key === "$ref") {
        expect(typeof entry).toBe("string");
        references.push(entry as string);
      } else {
        collectReferences(entry, references);
      }
    }
  }
  return references;
}

function contractOperations(document: JsonObject): Map<string, JsonObject> {
  const operations = new Map<string, JsonObject>();
  for (const [route, pathItemValue] of Object.entries(objectValue(document.paths, "paths"))) {
    const pathItem = objectValue(pathItemValue, `path ${route}`);
    for (const method of HTTP_METHODS) {
      if (pathItem[method] !== undefined) {
        operations.set(`${method.toUpperCase()} ${route}`, objectValue(pathItem[method], `${method} ${route}`));
      }
    }
  }
  return operations;
}

function expressRouteToOpenApi(route: string): string {
  return route.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
}

function implementedApplicationOperations(serverSource: string): string[] {
  const literalRegistrations = [
    ...serverSource.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)
  ].map((match) => `${match[1].toUpperCase()} ${expressRouteToOpenApi(match[2])}`);
  const allRegistrations = [
    ...serverSource.matchAll(/app\.(get|post|patch|delete|put|head|options)\(/g)
  ];
  expect(
    allRegistrations.length,
    "every HTTP route registration must be a literal route or the one reviewed non-API browser fallback"
  ).toBe(literalRegistrations.length + 1);
  expect(serverSource).toContain("app.get(/^\\/(?!api\\/).*/,");
  expect(serverSource).toContain('import { createCalendarConnectionRouter } from "./calendar-connections.js"');
  expect(serverSource).toContain("app.use(createCalendarConnectionRouter(");
  const routerSource = readSource(calendarConnectionRouterPath);
  const connectionRegistrations = [...routerSource.matchAll(/router\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)]
    .map((match) => `${match[1].toUpperCase()} ${expressRouteToOpenApi(match[2])}`);
  expect([...routerSource.matchAll(/router\.(get|post|patch|put|delete|head|options)\(/g)]).toHaveLength(connectionRegistrations.length);
  // The one public webhook has an exact app.post rate limiter and a mounted
  // handler for that same route; neither an unmounted route nor a second public
  // notification endpoint may silently disappear from the inventory.
  expect(serverSource).toContain("app.use(createCalendarProviderNotificationRouter(");
  const notifications = [...readSource(calendarNotificationRouterPath)
    .matchAll(/router\.(get|post|patch|put|delete|head|options)\(\s*"([^"]+)"/g)];
  expect(notifications.map((match) => `${match[1].toUpperCase()} ${match[2]}`))
    .toEqual(["POST /api/calendar-notifications/microsoft"]);
  expect(literalRegistrations).toContain("POST /api/calendar-notifications/microsoft");
  return [
    ...literalRegistrations,
    ...connectionRegistrations,
    "GET /qr/{qrId}"
  ].sort();
}

function operationPathFromExpression(expression: ts.Expression): string | null {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (!ts.isTemplateExpression(expression)) {
    return null;
  }
  let result = expression.head.text;
  for (const span of expression.templateSpans) {
    if (
      (ts.isIdentifier(span.expression) && span.expression.text === "suffix") ||
      (ts.isCallExpression(span.expression) && ts.isIdentifier(span.expression.expression) &&
        span.expression.expression.text === "pageSuffix") ||
      (ts.isCallExpression(span.expression) &&
        ts.isPropertyAccessExpression(span.expression.expression) &&
        span.expression.expression.name.text === "toString")
    ) {
      result = result.replace(/\?$/, "");
      result += span.literal.text;
      continue;
    }
    const placeholder = templatePlaceholder(span.expression);
    if (!placeholder) {
      return null;
    }
    result += `{${placeholder}}${span.literal.text}`;
  }
  // Native and provider clients deliberately share this same route parameter;
  // provider identity is explicit in the request discriminator, not a new URL.
  return result.split("?", 1)[0].replace(
    /^\/api\/calendar-events\/\{providerEventId\}$/,
    "/api/calendar-events/{eventId}"
  );
}

function templatePlaceholder(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "encodeURIComponent" &&
    expression.arguments.length === 1
  ) {
    return templatePlaceholder(expression.arguments[0]);
  }
  return null;
}

function methodFromOptions(expression: ts.Expression | undefined): string {
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    return "GET";
  }
  for (const property of expression.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText().replace(/["']/g, "") === "method" &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text.toUpperCase();
    }
  }
  return "GET";
}

function clientOperations(filePath: string, callName: "apiFetch" | "request"): string[] {
  const source = readSource(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const operations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const matchesCall =
        (callName === "apiFetch" && ts.isIdentifier(node.expression) && node.expression.text === "apiFetch") ||
        (callName === "request" &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "request");
      if (matchesCall && node.arguments[0]) {
        const route = operationPathFromExpression(node.arguments[0]);
        expect(route, `${filePath} API calls must use a statically inspectable path`).toBeTruthy();
        expect(route?.startsWith("/api/"), `${filePath} API calls must remain on the application API surface`).toBe(true);
        operations.push(`${methodFromOptions(node.arguments[1])} ${route}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...new Set(operations)].sort();
}

function directBrowserDownloads(filePath: string): string[] {
  const source = readSource(filePath);
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const operations: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(sourceFile) === "window.location.href"
    ) {
      const route = operationPathFromExpression(node.right);
      if (route?.startsWith("/api/")) {
        operations.push(`GET ${route}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return operations.sort();
}

function operationShape(operation: string): string {
  return operation.replace(/\{[^}]+\}/g, "{}");
}

function operationById(operations: Map<string, JsonObject>, operationId: string): JsonObject {
  const operation = [...operations.values()].find((candidate) => candidate.operationId === operationId);
  expect(operation, `missing operationId ${operationId}`).toBeTruthy();
  return operation as JsonObject;
}

function responseFor(document: JsonObject, operation: JsonObject, status: string): JsonObject {
  const response = objectValue(objectValue(operation.responses, "operation responses")[status], `response ${status}`);
  if (typeof response.$ref === "string") {
    return objectValue(resolveLocalRef(document, response.$ref), `resolved response ${status}`);
  }
  return response;
}

describe("Life Links OpenAPI v1", () => {
  it("keeps optional account email in owner connection/discovery metadata, not agent event content", () => {
    const document = parseStrictJson(readSource(contractPath));
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    for (const name of ["CalendarConnectionView", "CalendarAuthorizationDiscovery"]) {
      const schema = objectValue(schemas[name], name);
      expect(schema.required).toContain("providerAccountId");
      expect(schema.required).not.toContain("accountEmail");
      expect(objectValue(schema.properties, name).accountEmail).toEqual({ $ref: "#/components/schemas/CalendarAccountEmail" });
    }
    expect(objectValue(schemas.CalendarAccountEmail, "account email")).toMatchObject({ type: "string", format: "email", maxLength: 320 });
    expect(objectValue(objectValue(schemas.ProviderEventWritableContent, "provider content").properties, "provider properties"))
      .not.toHaveProperty("accountEmail");
  });

  it("publishes optional provider Calendar timezone metadata without requiring invented zones", () => {
    const document = parseStrictJson(readSource(contractPath));
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const properties = objectValue(objectValue(schemas.CalendarAuthorizationDiscovery, "discovery").properties, "discovery properties");
    const item = objectValue(objectValue(properties.calendars, "calendars").items, "discovered Calendar");
    expect(item.additionalProperties).toBe(false);
    expect(item.required).not.toContain("timeZone");
    expect(objectValue(item.properties, "Calendar properties").timeZone).toMatchObject({ type: "string", minLength: 1, maxLength: 100 });
  });

  it("parses as strict JSON with only resolvable local references", () => {
    const source = readSource(contractPath);
    const document = parseStrictJson(source);
    expect(() => parseStrictJson('{"duplicate": 1, "duplicate": 2}')).toThrow(/duplicate JSON object key/);
    expect(document.openapi).toBe("3.1.0");
    expect(objectValue(document.info, "info").version).toBe("1.0.0");
    expect(document.servers).toEqual([
      {
        url: "/",
        description: "Same-origin Life Links application"
      }
    ]);
    const references = collectReferences(document);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(() => resolveLocalRef(document, reference)).not.toThrow();
    }
  });

  it("publishes exactly the implemented HTTP routes and stable QR browser route", () => {
    const document = parseStrictJson(readSource(contractPath));
    const published = [...contractOperations(document).keys()].sort();
    const implemented = implementedApplicationOperations(readSource(serverPath));
    expect(published).toEqual(implemented);
    expect(published).toHaveLength(112);
    expect(published).toEqual(expect.arrayContaining(["GET /healthz", "GET /readyz", "GET /version"]));
    expect(document.tags).not.toContainEqual({ name: "projects" });
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    expect(schemas).not.toHaveProperty("Project");
    expect(objectValue(objectValue(schemas.Link, "Link").properties, "Link properties")).not.toHaveProperty("projectId");
    const operationIds = [...contractOperations(document).values()].map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(published.length);
    expect(operationIds.every((operationId) => typeof operationId === "string" && operationId.length > 0)).toBe(true);
  });

  it("publishes the safe runtime release-identity fields on health, readiness, and version", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const schemas = objectValue(objectValue(document.components, "components").schemas, "component schemas");
    const runtimeFields = objectValue(schemas.RuntimeFields, "RuntimeFields schema");
    expect(runtimeFields.required).toEqual([
      "system",
      "component",
      "env",
      "version",
      "build_sha",
      "canonical_source_sha",
      "source_tree_sha256",
      "build_time",
      "competition_fixture_profile",
      "store_mode"
    ]);
    const properties = objectValue(runtimeFields.properties, "RuntimeFields properties");
    expect(objectValue(properties.system, "runtime system").const).toBe("life_links");
    expect(objectValue(properties.competition_fixture_profile, "runtime fixture profile").const).toBe("webmcp-field-ledger-family-v3");
    expect(objectValue(properties.store_mode, "runtime store mode").enum).toEqual(["memory", "postgres"]);
    for (const field of ["build_sha", "canonical_source_sha", "source_tree_sha256"]) {
      expect(objectValue(properties[field], field)).toMatchObject({ type: "string", minLength: 1 });
    }

    for (const [key, operationId, successResponse] of [
      ["GET /healthz", "getLifeLinksHealth", "#/components/responses/HealthOk"],
      ["GET /readyz", "getLifeLinksReadiness", "#/components/responses/ReadinessOk"],
      ["GET /version", "getLifeLinksVersion", "#/components/responses/VersionOk"]
    ] as const) {
      const operation = operations.get(key);
      expect(operation, `missing ${key}`).toBeTruthy();
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toEqual([]);
      expect(objectValue(operation?.responses, `${key} responses`)["200"]).toEqual({ $ref: successResponse });
    }
    expect(objectValue(operations.get("GET /readyz")?.responses, "readiness responses")["503"]).toEqual({
      $ref: "#/components/responses/ReadinessUnavailable"
    });
  });

  it("keeps the supported web client inside the published operation surface", () => {
    const operations = contractOperations(parseStrictJson(readSource(contractPath)));
    const publishedShapes = new Set([...operations.keys()].map(operationShape));
    const webOperations = clientOperations(webClientPath, "apiFetch");
    const downloads = directBrowserDownloads(webControllerPath);
    expect(webOperations).toEqual(EXPECTED_WEB_CLIENT_OPERATIONS);
    expect(downloads).toEqual(["GET /api/qr-batches/{lastBatchId}.zip"]);
    expect(readSource(webControllerPath)).toContain("`/qr/${encodeURIComponent(qrId)}`");
    for (const clientOperation of [...webOperations, ...downloads]) {
      expect(publishedShapes, `undocumented client operation ${clientOperation}`).toContain(operationShape(clientOperation));
    }
    expect(operations.has("GET /qr/{qrId}")).toBe(true);
    const qrResponses = objectValue(operations.get("GET /qr/{qrId}")?.responses, "QR browser responses");
    expect(qrResponses["200"]).toEqual({ $ref: "#/components/responses/BrowserPageOk" });
    expect(qrResponses["307"]).toMatchObject({ headers: {
      Location: { schema: { type: "string", format: "uri" } },
      "Cache-Control": { schema: { type: "string", const: "no-store" } }
    } });
  });

  it("publishes the canonical authentication, browser-origin, and response-envelope boundaries", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const components = objectValue(document.components, "components");
    const securitySchemes = objectValue(components.securitySchemes, "security schemes");
    const componentParameters = objectValue(components.parameters, "component parameters");
    const requestIdParameter = objectValue(componentParameters.XRequestId, "X-Request-Id parameter");
    const requestIdParameterDescription =
      "Optional caller-supplied request correlation identifier. A valid value is echoed in the response. A missing value, a value outside the accepted grammar, or a value in the native session-token lexical space is ignored and replaced with a server-generated UUID.";
    const requestIdHeader = objectValue(objectValue(components.headers, "component headers").RequestId, "RequestId header");
    const requestIdSchemaReference = { $ref: "#/components/schemas/RequestId" };
    const requestIdSchema = objectValue(objectValue(components.schemas, "component schemas").RequestId, "RequestId schema");
    expect(requestIdParameter).toEqual({
      name: "X-Request-Id",
      in: "header",
      required: false,
      description: requestIdParameterDescription,
      schema: requestIdSchemaReference
    });
    expect(requestIdHeader.schema).toEqual(requestIdSchemaReference);
    expect(requestIdSchema).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
      not: { pattern: "^[A-Za-z0-9_-]{43}$" }
    });
    const serverSource = readSource(serverPath);
    expect(serverSource).toContain('request.get("x-request-id")?.trim()');
    expect(serverSource).toContain('/^[a-zA-Z0-9._:-]{1,128}$/.test(candidate)');
    expect(serverSource).toContain("!hasSessionTokenShape(candidate)");
    expect(serverSource).toContain("return randomUUID()");
    const passwordSource = readSource(passwordPath);
    expect(passwordSource).toContain("const SESSION_TOKEN_BYTES = 32");
    expect(passwordSource).toContain("const SESSION_TOKEN_LENGTH = Math.ceil((SESSION_TOKEN_BYTES * 4) / 3)");
    expect(passwordSource).toContain("value.length === SESSION_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)");
    expect(securitySchemes.CookieSession).toEqual({
      type: "apiKey",
      in: "cookie",
      name: "life_links_session",
      description: "HTTP-only, SameSite=Lax browser session cookie."
    });
    expect(objectValue(securitySchemes.BearerSession, "bearer scheme")).toMatchObject({
      type: "http",
      scheme: "bearer"
    });
    expect(document.security).toEqual([{ CookieSession: [] }, { BearerSession: [] }]);

    const protectedOperationIds = [
      "getCalendarClock",
      "listCalendars",
      "createCalendar",
      "getCalendar",
      "updateCalendar",
      "deleteCalendar",
      "restoreCalendar",
      "listCalendarEvents",
      "createCalendarEvent",
      "getCalendarEvent",
      "updateCalendarEvent",
      "deleteCalendarEvent",
      "restoreCalendarEvent",
      "listRoutineGroups",
      "createRoutineGroup",
      "getRoutineGroup",
      "updateRoutineGroup",
      "listRoutineActivities",
      "createRoutineActivity",
      "getRoutineActivity",
      "updateRoutineActivity",
      "listRoutines",
      "createRoutine",
      "getRoutine",
      "getActiveRoutineRun",
      "updateRoutine",
      "reviseRoutine",
      "getRoutineRevision",
      "listRoutineSchedules",
      "createRoutineSchedule",
      "updateRoutineSchedule",
      "listRoutineOccurrences",
      "getRoutineOccurrence",
      "startRoutineRun",
      "getRoutineRun",
      "putRoutineRunStepResult",
      "finalizeRoutineRun",
      "listRoutineSessions",
      "getRoutineSession",
      "appendRoutineSessionAmendment",
      "listCanonicalLifeLinks",
      "createCanonicalLifeLink",
      "searchCanonicalLifeLinks",
      "getCanonicalLifeLink",
      "updateCanonicalLifeLink",
      "moveCanonicalLifeLink",
      "uploadCanonicalLifeLinkMedia",
      "getCanonicalLifeLinkMedia",
      "deleteCanonicalLifeLinkMedia",
      "listOwnedLifeLinks",
      "uploadLifeLinkMedia",
      "deleteLifeLinkMedia",
      "createLifeLinkQrBatch",
      "downloadLifeLinkQrBatchCsv",
      "downloadLifeLinkQrBatchZip",
      "claimLifeLinkQr",
      "evaluateLifeLinkFindScan",
      "connectLifeLinksAgent",
      "disconnectLifeLinksAgent"
    ];
    for (const operationId of protectedOperationIds) {
      const operation = operationById(operations, operationId);
      expect(operation.security, `${operationId} must inherit required session security`).toBeUndefined();
      expect(objectValue(operation.responses, `${operationId} responses`)).toHaveProperty("401");
    }

    for (const operationId of [
      "getLifeLinksHealth",
      "getLifeLinksReadiness",
      "getLifeLinksVersion",
      "getLifeLinksConfig",
      "loginLifeLinksOwner"
    ]) {
      expect(operationById(operations, operationId).security, `${operationId} must remain public`).toEqual([]);
    }
    for (const operationId of [
      "logoutLifeLinksOwner",
      "getLifeLinksSession",
      "getLifeLinkMedia",
      "resolveLifeLinkQr",
      "openLifeLinkQrPage"
    ]) {
      expect(operationById(operations, operationId).security, `${operationId} must allow unauthenticated access`).toContainEqual(
        {}
      );
    }

    const mutatingOperations = [...operations.entries()].filter(([key]) => /^(POST|PATCH|PUT|DELETE) /.test(key));
    for (const [key, operation] of mutatingOperations) {
      const parameters = (operation.parameters ?? []) as JsonObject[];
      if (key === "POST /api/calendar-notifications/microsoft") {
        expect(operation.security).toEqual([]);
        expect(parameters).not.toContainEqual({ $ref: "#/components/parameters/BrowserOrigin" });
        expect(String(operation.description)).toContain("clientState hash");
        continue;
      }
      expect(parameters, `${key} must describe browser Origin enforcement`).toContainEqual({
        $ref: "#/components/parameters/BrowserOrigin"
      });
      expect(objectValue(operation.responses, `${key} responses`)).toHaveProperty("403");
    }

    for (const [key, operation] of operations) {
      const requestIdParameters = ((operation.parameters ?? []) as JsonObject[]).filter((parameter) => {
        return (
          parameter.$ref === "#/components/parameters/XRequestId" ||
          (String(parameter.name).toLowerCase() === "x-request-id" && parameter.in === "header")
        );
      });
      expect(requestIdParameters, `${key} must expose exactly one optional inbound X-Request-Id parameter`).toEqual([
        { $ref: "#/components/parameters/XRequestId" }
      ]);
      const responses = objectValue(operation.responses, `${key} responses`);
      for (const status of Object.keys(responses)) {
        const response = responseFor(document, operation, status);
        expect(objectValue(response.headers, `${key} ${status} headers`)["X-Request-Id"]).toEqual({
          $ref: "#/components/headers/RequestId"
        });
      }
    }
  });

  it("publishes a one-time durable agent connection separate from application sessions", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const connection = objectValue(schemas.AgentConnection, "AgentConnection");
    expect(connection.required).toEqual(["connected", "connectedAt", "toolCatalogId"]);
    expect(objectValue(connection.properties, "AgentConnection properties")).toMatchObject({
      connected: { type: "boolean" },
      connectedAt: {
        oneOf: [{ type: "string", format: "date-time" }, { type: "null" }]
      },
      toolCatalogId: {
        oneOf: [
          { type: "string", enum: ["life-links-page-webmcp-v1", "life-links-calendar-v2", "life-links-workspace-v3"] },
          { type: "null" }
        ]
      }
    });

    const connectionRequest = objectValue(schemas.AgentConnectionRequest, "AgentConnectionRequest");
    expect(connectionRequest).toMatchObject({ type: "object", additionalProperties: false });
    expect(objectValue(connectionRequest.properties, "AgentConnectionRequest properties")).toMatchObject({
      toolCatalogId: {
        type: "string",
        enum: ["life-links-page-webmcp-v1", "life-links-calendar-v2", "life-links-workspace-v3"]
      }
    });

    for (const [key, operationId] of [
      ["PUT /api/agent-connection", "connectLifeLinksAgent"],
      ["DELETE /api/agent-connection", "disconnectLifeLinksAgent"]
    ] as const) {
      const operation = operations.get(key);
      expect(operation?.operationId).toBe(operationId);
      expect(operation?.security).toBeUndefined();
      expect(operation?.parameters).toContainEqual({ $ref: "#/components/parameters/BrowserOrigin" });
      expect(objectValue(operation?.responses, `${key} responses`)).toMatchObject({
        "200": { $ref: "#/components/responses/AgentConnectionOk" },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "403": { $ref: "#/components/responses/Forbidden" }
      });
    }
    expect(objectValue(operations.get("PUT /api/agent-connection")?.responses, "PUT agent connection responses"))
      .toMatchObject({ "400": { $ref: "#/components/responses/BadRequest" } });

    const login = objectValue(schemas.LoginResponse, "LoginResponse");
    const me = objectValue(schemas.MeResponse, "MeResponse");
    expect(login.required).toContain("agentConnection");
    expect(me.required).toContain("agentConnection");
    expect(String(operationById(operations, "logoutLifeLinksOwner").description)).toContain("idempotent");
    const responses = objectValue(objectValue(document.components, "components").responses, "responses");
    expect(String(objectValue(responses.LogoutNoContent, "LogoutNoContent").description)).toContain("agent connection");
  });

  it("documents Workspace-v3 narrowing on existing Collection and Routine routes without granting other Routine operations", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    for (const key of ["POST /api/collections/changes/preview", "GET /api/collections/changes/{previewId}",
      "POST /api/collections/changes/apply", "GET /api/routines", "GET /api/routines/{routineId}", "PATCH /api/routines/{routineId}"]) {
      const operation = operations.get(key)!;
      expect(operation.parameters).toContainEqual(expect.objectContaining({ name: "X-Life-Links-Actor", in: "header",
        description: expect.stringContaining("life-links-workspace-v3") }));
      expect(objectValue(operation.responses, `${key} responses`)["403"]).toBeDefined();
    }
    expect(operations.get("PATCH /api/routines/{routineId}")?.description).toContain("archive-only");
    expect(operations.get("POST /api/routines")!.parameters)
      .toContainEqual(expect.objectContaining({ name: "X-Life-Links-Actor", description: expect.stringContaining("Human-owner operation only") }));
  });

  it("publishes owner-only general Routines with closed typed values, immutable history, and bounded errors", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const components = objectValue(document.components, "components");
    const schemas = objectValue(components.schemas, "schemas");
    const responses = objectValue(components.responses, "responses");
    const routineOperations = EXPECTED_WEB_CLIENT_OPERATIONS.filter((key) => key.includes("/routine"));

    expect(routineOperations).toHaveLength(28);
    for (const key of routineOperations) {
      const operation = operations.get(key);
      expect(operation, key).toBeTruthy();
      expect(operation?.security, `${key} must inherit owner session security`).toBeUndefined();
      expect(objectValue(operation?.responses, `${key} responses`)).toHaveProperty("401");
    }
    expect([...operations.keys()].filter((key) => key.includes("routine") && !key.startsWith("GET /api/") && !/^(POST|PATCH|PUT) \/api\//.test(key))).toEqual([]);

    expect(objectValue(schemas.RoutineErrorCode, "RoutineErrorCode").enum).toEqual([
      "invalid_routine",
      "routine_not_found",
      "stale_routine",
      "routine_conflict",
      "routine_reference_conflict"
    ]);
    const errorEnvelope = objectValue(schemas.RoutineErrorResponse, "RoutineErrorResponse");
    expect(errorEnvelope.additionalProperties).toBe(false);
    const error = objectValue(objectValue(errorEnvelope.properties, "RoutineErrorResponse properties").error, "Routine error");
    expect(error.additionalProperties).toBe(false);
    expect(error.required).toEqual(["code", "message", "retryable"]);
    expect(String(objectValue(responses.RoutineConflict, "RoutineConflict").description)).toContain("Only stale_routine is retryable");
    for (const responseName of ["RoutineBadRequest", "RoutineNotFound", "RoutineConflict"]) {
      expect(objectValue(responses[responseName], responseName)).toMatchObject({
        content: { "application/json": { schema: { $ref: "#/components/schemas/RoutineErrorResponse" } } }
      });
    }

    const routineValue = objectValue(schemas.RoutineValue, "RoutineValue");
    const valueVariants = routineValue.oneOf as JsonObject[];
    expect(valueVariants).toHaveLength(5);
    expect(valueVariants.map((variant) => objectValue(objectValue(variant.properties, "value properties").kind, "value kind").const)).toEqual([
      "number",
      "quantity",
      "duration",
      "text",
      "boolean"
    ]);
    expect(valueVariants.every((variant) => variant.additionalProperties === false)).toBe(true);

    const scheduleVariants = objectValue(schemas.RoutineScheduleRule, "RoutineScheduleRule").oneOf as JsonObject[];
    expect(scheduleVariants.map((variant) => objectValue(objectValue(variant.properties, "schedule properties").kind, "schedule kind").const)).toEqual([
      "once",
      "daily",
      "weekly"
    ]);
    expect(scheduleVariants.every((variant) => variant.additionalProperties === false)).toBe(true);

    const routineSummary = objectValue(schemas.RoutineSummary, "RoutineSummary");
    expect(routineSummary.additionalProperties).toBe(false);
    expect(routineSummary.required).toEqual([
      "id", "ownerId", "groupId", "currentRevisionId", "createdAt", "updatedAt", "archivedAt",
      "revisionNumber", "title", "purpose"
    ]);
    const routineList = objectValue(schemas.RoutineListResponse, "RoutineListResponse");
    expect(objectValue(objectValue(objectValue(routineList.properties, "RoutineListResponse properties").routines, "routines").items, "routine items"))
      .toEqual({ $ref: "#/components/schemas/RoutineSummary" });
    const activeRun = operationById(operations, "getActiveRoutineRun");
    expect(objectValue(activeRun.responses, "active Run responses")["200"]).toEqual({
      $ref: "#/components/responses/RoutineActiveRunOk"
    });
    expect(objectValue(schemas.RoutineActiveRunResponse, "RoutineActiveRunResponse").required).toEqual(["run"]);

    for (const name of [
      "RoutineGroupCreateRequest",
      "RoutineGroupPatchRequest",
      "ActivityCreateRequest",
      "ActivityPatchRequest",
      "RoutineCreateRequest",
      "RoutineRevisionCreateRequest",
      "RoutinePatchRequest",
      "RoutineScheduleCreateRequest",
      "RoutineSchedulePatchRequest",
      "RoutineRunStartRequest",
      "RoutineRunStepResultPutRequest",
      "RoutineRunFinalizeRequest",
      "RoutineSessionAmendmentCreateRequest"
    ]) {
      expect(objectValue(schemas[name], name).additionalProperties, `${name} must reject unknown input`).toBe(false);
    }
    expect(objectValue(schemas.RoutineRunStartRequest, "RoutineRunStartRequest").required).toContain("id");
    expect(objectValue(schemas.RoutineRunFinalizeRequest, "RoutineRunFinalizeRequest").required).toContain("sessionId");
    expect(objectValue(schemas.RoutineSessionAmendmentCreateRequest, "RoutineSessionAmendmentCreateRequest").required).toContain("id");
    for (const name of ["RoutineCreateRequest", "RoutineRevisionCreateRequest"]) {
      const steps = objectValue(objectValue(objectValue(schemas[name], name).properties, `${name} properties`).steps, `${name} steps`);
      expect(steps).not.toHaveProperty("minItems");
    }
    expect(objectValue(schemas.RoutineRunStepResultPutRequest, "RoutineRunStepResultPutRequest").required).toEqual([
      "expectedUpdatedAt",
      "actualValues",
      "proposedNextValues"
    ]);
  });

  it("publishes owner-only Calendars with an authoritative clock, bounded windows and fail-closed recurrence mutation scopes", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const components = objectValue(document.components, "components");
    const schemas = objectValue(components.schemas, "schemas");
    const parameters = objectValue(components.parameters, "parameters");
    const responses = objectValue(components.responses, "responses");
    const calendarOperations = EXPECTED_WEB_CLIENT_OPERATIONS.filter((key) =>
      key.includes("/calendar")
    );

    expect(calendarOperations).toHaveLength(28);
    for (const key of calendarOperations) {
      const operation = operations.get(key);
      expect(operation, key).toBeTruthy();
      if (key.includes("/calendar-authorizations/") || /^POST \/api\/calendar-providers\/(microsoft|google)\/authorize$/.test(key)) {
        expect(operation?.security, `${key} requires the initiating browser session`).toEqual([{ CookieSession: [] }]);
      } else expect(operation?.security, `${key} must inherit owner session security`).toBeUndefined();
      expect(objectValue(operation?.responses, `${key} responses`)).toHaveProperty("401");
    }

    const nativeOperations = calendarOperations.filter((key) => /\/api\/(?:calendars|calendar-events|calendar-clock)(?:\/|$)/.test(key));
    expect(nativeOperations).toHaveLength(13);
    for (const key of nativeOperations) {
      const operation = operations.get(key)!;
      expect(operation.parameters, `${key} must declare agent request narrowing`).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "X-Life-Links-Actor", in: "header", required: false,
          schema: { type: "string", enum: ["agent"] } })
      ]));
      const forbidden = objectValue(operation.responses, `${key} responses`)["403"];
      if (key.includes("/calendar-events") && !key.endsWith("/restore")) {
        expect(forbidden).toMatchObject({ content: { "application/json": { schema: { anyOf: [
          { $ref: "#/components/schemas/CalendarErrorResponse" },
          { $ref: "#/components/schemas/ProviderCalendarEventErrorResponse" },
          { $ref: "#/components/schemas/ErrorResponse" }
        ] } } } });
      } else expect(forbidden).toEqual({ $ref: "#/components/responses/CalendarForbidden" });
    }
    expect(objectValue(schemas.Calendar, "Calendar").required).toContain("agentAccess");
    for (const name of ["Calendar", "CalendarCreateRequest", "CalendarPatchRequest"]) {
      const properties = objectValue(objectValue(schemas[name], name).properties, `${name} properties`);
      expect(objectValue(properties.agentAccess, `${name} agentAccess`).enum).toEqual(["none", "read", "write"]);
    }
    expect(objectValue(objectValue(objectValue(schemas.CalendarCreateRequest, "CalendarCreateRequest").properties,
      "CalendarCreateRequest properties").agentAccess, "create agentAccess").default).toBe("write");

    const eventList = operationById(operations, "listCalendarEvents");
    expect(String(eventList.description)).toContain("at most 366 days");
    expect(String(eventList.description)).toContain("does not expand recurrence instances");
    expect(eventList.parameters).toEqual(expect.arrayContaining([
      { $ref: "#/components/parameters/CalendarStartDate" },
      { $ref: "#/components/parameters/CalendarEndDate" }
    ]));
    expect(objectValue(parameters.CalendarStartDate, "CalendarStartDate").required).toBe(true);
    expect(objectValue(parameters.CalendarEndDate, "CalendarEndDate").required).toBe(true);

    const clock = operationById(operations, "getCalendarClock");
    expect(String(clock.description)).toContain("server clock");
    expect(objectValue(schemas.CalendarClock, "CalendarClock").required).toEqual([
      "serverTime", "timeZone", "today"
    ]);

    expect(objectValue(schemas.CalendarErrorCode, "CalendarErrorCode").enum).toEqual([
      "invalid_calendar",
      "calendar_not_found",
      "invalid_calendar_event",
      "calendar_event_not_found",
      "stale_calendar",
      "stale_calendar_event",
      "calendar_conflict",
      "calendar_reference_conflict",
      "calendar_access_denied"
    ]);
    const subjectLinks = objectValue(schemas.CalendarSubjectLink, "CalendarSubjectLink").oneOf as JsonObject[];
    expect(subjectLinks.map((variant) =>
      objectValue(objectValue(variant.properties, "subject-link properties").kind, "subject-link kind").const
    )).toEqual([
      "life_link",
      "collection",
      "routine",
      "routine_schedule",
      "routine_occurrence",
      "routine_session"
    ]);
    const editTargets = objectValue(schemas.CalendarEventEditTarget, "CalendarEventEditTarget").oneOf as JsonObject[];
    expect(editTargets.map((variant) =>
      objectValue(objectValue(variant.properties, "edit-target properties").scope, "edit-target scope").const
    )).toEqual(["event", "series"]);
    for (const name of [
      "CalendarCreateRequest",
      "CalendarPatchRequest",
      "CalendarRevisionRequest",
      "CalendarEventCreateRequest",
      "CalendarEventRevisionRequest",
      "CalendarEventDeleteRequest",
      "CalendarEventRestoreRequest"
    ]) {
      expect(objectValue(schemas[name], name).additionalProperties, `${name} must reject unknown input`).toBe(false);
    }
    for (const responseName of ["CalendarBadRequest", "CalendarNotFound", "CalendarConflict"]) {
      expect(objectValue(responses[responseName], responseName)).toMatchObject({
        content: { "application/json": { schema: { $ref: "#/components/schemas/CalendarErrorResponse" } } }
      });
    }
  });

  it("publishes explicit provider event authority without weakening native schemas or admitting outbound effects", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    for (const [operationId, native, provider] of [
      ["createCalendarEvent", "CalendarEventCreateRequest", "ProviderCalendarEventCreateRequest"],
      ["updateCalendarEvent", "CalendarEventRevisionRequest", "ProviderCalendarEventUpdateRequest"],
      ["deleteCalendarEvent", "CalendarEventDeleteRequest", "ProviderCalendarEventDeleteRequest"]
    ]) {
      const operation = operationById(operations, operationId);
      expect(operation.requestBody).toMatchObject({ content: { "application/json": { schema: { oneOf: [
        { $ref: `#/components/schemas/${native}` }, { $ref: `#/components/schemas/${provider}` }
      ] } } } });
      expect(objectValue(schemas[native], native).additionalProperties).toBe(false);
      const request = objectValue(schemas[provider], provider);
      expect(request.additionalProperties).toBe(false);
      expect(request.required).toEqual(expect.arrayContaining(["authority", "commandId", "connectionId", "calendarId"]));
      const properties = objectValue(request.properties, "provider properties");
      expect(properties.authority).toEqual({ const: "provider" });
      expect(properties).not.toHaveProperty("confirmed");
      if (operationId !== "createCalendarEvent") {
        expect(properties.scope).toEqual({ const: "event" });
        expect(request.required).toContain("expectedProviderRevision");
      }
      expect(String(operation.description)).toContain("standalone events only");
    }
    const content = objectValue(schemas.ProviderEventWritableContent, "writable provider content");
    expect(content.additionalProperties).toBe(false);
    expect(Object.keys(objectValue(content.properties, "content fields")).sort())
      .toEqual(["title", "description", "location", "span", "status"].sort());
    const projection = objectValue(schemas.CalendarProviderEventProjection, "provider projection");
    expect(projection.required).toEqual(expect.arrayContaining([
      "ownerId", "connectionId", "calendarId", "providerKey", "providerAccountId", "providerCalendarId",
      "providerEventId", "providerRevision", "content", "synchronizedAt"
    ]));
    expect(objectValue(objectValue(schemas.CalendarListResponse, "Calendar listing").properties, "listing fields"))
      .toHaveProperty("providerBindings");
    expect(String(operationById(operations, "listCalendarEvents").description)).toContain("historical dates");
  });

  it("documents exact browser-session OAuth and the sole independently authenticated notification route", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const callback = operationById(operations, "completeMicrosoftCalendarCallback");
    expect(callback.security).toEqual([{ CookieSession: [] }, {}]);
    expect(String(callback.description)).toContain("one-use state");
    expect(String(callback.description)).toContain("PKCE S256");
    const redirect = responseFor(document, callback, "303");
    expect(redirect).not.toHaveProperty("content");
    expect(redirect.headers).toMatchObject({ "Cache-Control": { schema: { const: "no-store" } },
      "Referrer-Policy": { schema: { const: "no-referrer" } } });
    for (const name of ["authorizeMicrosoftCalendar", "discoverAuthorizedMicrosoftCalendars",
      "completeMicrosoftCalendarAuthorization", "cancelMicrosoftCalendarAuthorization"]) {
      expect(operationById(operations, name).security).toEqual([{ CookieSession: [] }]);
    }
    expect(objectValue(schemas.CalendarProviderSelectionRequest, "selection")).toMatchObject({
      additionalProperties: false, required: ["selectedCalendarIds"],
      properties: { selectedCalendarIds: { minItems: 1, maxItems: 50, uniqueItems: true },
        agentAccessByCalendarId: { type: "object", minProperties: 1, maxProperties: 50,
          additionalProperties: { type: "string", enum: ["none", "read", "write"] } } }
    });
    const connectionProperties = objectValue(objectValue(schemas.CalendarConnectionView, "connection").properties, "connection fields");
    expect(connectionProperties.credentialStatus).toEqual({ enum: ["ready", "reconnect_required", "not_retained"] });
    expect(connectionProperties).not.toHaveProperty("credentialHandle");
    expect(connectionProperties).not.toHaveProperty("accessToken");
    const availability = objectValue(objectValue(schemas.CalendarProviderAvailability, "availability").properties, "availability fields");
    expect(availability.authorizationAvailable).toEqual({ type: "boolean" });
    const webhook = operationById(operations, "receiveMicrosoftCalendarNotification");
    expect(webhook.security).toEqual([]);
    expect(String(webhook.description)).toContain("constant-time matching clientState hash");
    expect(String(webhook.description)).toContain("never write event truth");
    expect(responseFor(document, webhook, "200").content).toHaveProperty("text/plain");
    expect(responseFor(document, webhook, "202").content).toHaveProperty("text/plain");
  });

  it("pins the bounded canonical hierarchy contract and keeps public QR schemas compatibility-only", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    expect([...operations.keys()]).toEqual(
      expect.arrayContaining([
        "GET /api/life-links",
        "POST /api/life-links",
        "GET /api/life-links/search",
        "GET /api/life-links/{lifeLinkId}",
        "PATCH /api/life-links/{lifeLinkId}",
        "PATCH /api/life-links/{lifeLinkId}/parent",
        "POST /api/life-links/{lifeLinkId}/media",
        "GET /api/life-links/{lifeLinkId}/media/{mediaId}",
        "DELETE /api/life-links/{lifeLinkId}/media/{mediaId}"
      ])
    );

    const components = objectValue(document.components, "components");
    const schemas = objectValue(components.schemas, "schemas");
    const parameters = objectValue(components.parameters, "parameters");
    expect(objectValue(schemas.LifeLinkId, "LifeLinkId")).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 200,
      pattern: "^[A-Za-z0-9._:-]+$"
    });
    expect(objectValue(schemas.LifeLinkCursor, "LifeLinkCursor")).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 4096
    });
    expect(objectValue(objectValue(parameters.LifeLinkPageLimit, "page limit").schema, "page limit schema")).toEqual({
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 25
    });
    expect(objectValue(objectValue(parameters.LifeLinkSearchQuery, "search query").schema, "search query schema")).toMatchObject({
      type: "string",
      minLength: 1,
      maxLength: 2048
    });

    const createRequest = objectValue(schemas.LifeLinkCreateRequest, "create request");
    const createProperties = objectValue(createRequest.properties, "create properties");
    expect(objectValue(createProperties.title, "create title").default).toBe("Untitled link");
    expect(objectValue(createProperties.privacy, "create privacy").default).toBe("private");
    const updateRequest = objectValue(schemas.LifeLinkPatchRequest, "patch request");
    expect(updateRequest.required).toEqual(["expectedUpdatedAt"]);
    expect(updateRequest.anyOf).toEqual(
      expect.arrayContaining([
        { required: ["title"] },
        { required: ["body"] },
        { required: ["bodyDoc"] },
        { required: ["privacy"] }
      ])
    );
    expect(objectValue(schemas.LifeLinkErrorCode, "error code").enum).toEqual([
      "life_link_not_found",
      "invalid_life_link",
      "duplicate_life_link_id",
      "invalid_parent",
      "hierarchy_cycle",
      "stale_life_link",
      "qr_already_bound",
      "qr_not_found",
      "life_link_already_tagged",
      "invalid_collection",
      "collection_not_found",
      "stale_collection",
      "duplicate_collection_id",
      "section_not_found",
      "invalid_section",
      "duplicate_section_id",
      "collection_membership_not_found",
      "output_limit_exceeded"
    ]);

    const publicQr = operationById(operations, "resolveLifeLinkQr");
    expect(String(publicQr.description)).toContain("ownerId to null");
    expect(String(publicQr.description)).toContain("never expose canonical Life Link identity");
    const publicLinkProperties = objectValue(objectValue(schemas.Link, "legacy Link").properties, "legacy Link properties");
    for (const field of ["lifeLinkId", "parentId", "ancestry", "children", "path", "hierarchy", "rootId", "descendants"]) {
      expect(publicLinkProperties, `public compatibility Link must omit ${field}`).not.toHaveProperty(field);
    }
    expect(objectValue(schemas.QrPrivateState, "private QR state").required).toEqual(["state", "qrId"]);
  });

  it("describes canonical role, context and public-field inputs with server-owned placement", () => {
    const document = parseStrictJson(readSource(contractPath));
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const lifeLink = createCanonicalLifeLink({
      id: "life-link-schema-fixture",
      ownerId: "owner-schema-fixture",
      createdAt: "2026-08-29T12:00:00.000Z",
      browsingRole: "container",
      context: { schemaVersion: 1, condition: { text: "Ready", truthState: "owner_reported" } },
      publicFieldKeys: ["condition"]
    });
    for (const [name, value] of [["LifeLink", lifeLink], ["LifeLinkSummary", summarizeLifeLink(lifeLink, 0)]] as const) {
      const schema = objectValue(schemas[name], name);
      expect(schema.additionalProperties).toBe(false);
      expect([...(schema.required as string[])].sort()).toEqual(Object.keys(value).sort());
      expect(Object.keys(objectValue(schema.properties, `${name} properties`)).sort()).toEqual(Object.keys(value).sort());
    }
    const properties = objectValue(objectValue(schemas.LifeLink, "LifeLink").properties, "LifeLink properties");
    expect(properties.browsingRole).toEqual({ $ref: "#/components/schemas/LifeLinkBrowsingRole" });
    expect(properties.context).toEqual({ $ref: "#/components/schemas/LifeLinkContext" });
    expect(properties.placementConfirmedAt).toMatchObject({ oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] });
    expect(properties.publicFieldKeys).toMatchObject({
      type: "array", maxItems: 5, uniqueItems: true, items: { $ref: "#/components/schemas/LifeLinkPublicFieldKey" }
    });
    expect(objectValue(schemas.LifeLinkContext, "LifeLinkContext")).toMatchObject({
      additionalProperties: false, required: ["schemaVersion"], properties: { schemaVersion: { const: 1 } }
    });
    const create = objectValue(objectValue(schemas.LifeLinkCreateRequest, "create").properties, "create properties");
    expect(create).toHaveProperty("id");
    expect(create).toHaveProperty("browsingRole");
    expect(create).toHaveProperty("context");
    expect(create).toHaveProperty("publicFieldKeys");
    expect(create).not.toHaveProperty("placementConfirmedAt");
    const patch = objectValue(objectValue(schemas.LifeLinkPatchRequest, "patch").properties, "patch properties");
    expect(patch).toHaveProperty("context");
    expect(patch).toHaveProperty("publicFieldKeys");
    expect(patch).not.toHaveProperty("browsingRole");
    expect(patch).not.toHaveProperty("placementConfirmedAt");
    const link = objectValue(objectValue(schemas.Link, "Link").properties, "Link properties");
    expect(link).toHaveProperty("context");
    expect(link).not.toHaveProperty("publicFieldKeys");
  });

  it("publishes Collection revisions, bounded Sections, exhaustive assignments and QR command identity", () => {
    const document = parseStrictJson(readSource(contractPath));
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const operations = contractOperations(document);
    for (const key of EXPECTED_WEB_CLIENT_OPERATIONS.filter((key) => key.includes("/collections") || key.includes("/qr-binding") || key.includes("/collection-memberships"))) {
      expect(operations.has(key), key).toBe(true);
      expect(operations.get(key)?.security).toBeUndefined();
      expect(objectValue(operations.get(key)?.responses, `${key} responses`)).toHaveProperty("401");
    }
    expect(operations.has("GET /api/collections/{collectionId}/sections")).toBe(false);
    const detail = objectValue(schemas.CollectionDetailResponse, "CollectionDetailResponse");
    expect(detail.required).toEqual(["collection", "sections", "sectionsPage"]);
    const membership = objectValue(objectValue(schemas.LifeLinkCollectionMembership, "membership").properties, "membership properties");
    expect(objectValue(membership.sections, "membership sections")).not.toHaveProperty("maxItems");
    const assignments = objectValue(schemas.CollectionSectionAssignmentsRequest, "assignment command");
    expect(assignments.required).toEqual(["sectionIds", "expectedUpdatedAt"]);
    expect(objectValue(schemas.QrBindingSetRequest, "set QR").required).toEqual(["commandId", "qrId", "expectedUpdatedAt"]);
    expect(objectValue(schemas.QrBindingClearRequest, "clear QR").required).toEqual(["commandId", "expectedUpdatedAt"]);
  });

  it("binds claim retries to command identity, authenticated owner, and QR without logging raw command ids", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operations = contractOperations(document);
    const claim = operationById(operations, "claimLifeLinkQr");
    const description = String(claim.description);
    expect(description).toContain("body value takes precedence");
    expect(description).toContain("same effective owner and QR");
    expect(description).toContain("recorded claim result with the current authorized QR state");
    expect(description).toContain("idempotency_key_conflict");
    expect((claim.parameters as JsonObject[])).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey"
    });

    const components = objectValue(document.components, "components");
    const parameters = objectValue(components.parameters, "component parameters");
    expect(objectValue(objectValue(parameters.IdempotencyKey, "Idempotency-Key").schema, "Idempotency-Key schema")).toMatchObject({
      type: "string",
      maxLength: 128
    });
    const schemas = objectValue(components.schemas, "schemas");
    const commandId = objectValue(
      objectValue(objectValue(schemas.ClaimRequest, "ClaimRequest").properties, "ClaimRequest properties").commandId,
      "commandId"
    );
    expect(commandId).toMatchObject({ type: "string", maxLength: 128 });
    expect(commandId).not.toHaveProperty("minLength");
    const conflictError = objectValue(
      objectValue(objectValue(schemas.IdempotencyConflictError, "IdempotencyConflictError").properties, "conflict properties")
        .error,
      "conflict error"
    );
    expect(conflictError.const).toBe("idempotency_key_conflict");
    const conflictResponse = responseFor(document, claim, "409");
    expect(String(responseFor(document, claim, "200").description)).toContain(
      "recorded result with the current authorized QR state"
    );
    const conflictSchema = objectValue(
      objectValue(objectValue(conflictResponse.content, "claim conflict content")["application/json"], "claim conflict JSON")
        .schema,
      "claim conflict schema"
    );
    expect(conflictSchema.oneOf).toEqual([
      { $ref: "#/components/schemas/ClaimOwnedByOtherResponse" },
      { $ref: "#/components/schemas/IdempotencyConflictError" },
      { $ref: "#/components/schemas/LifeLinkErrorResponse" }
    ]);

    const serverSource = readSource(serverPath);
    const storeSource = readSource(storePath);
    expect(serverSource).toContain('const bodyCommandId = String(claimBody.commandId ?? "").trim()');
    expect(serverSource).toContain(
      'const headerCommandId = String(request.headers["idempotency-key"] ?? "").trim()'
    );
    expect(serverSource).toContain("const commandId = bodyCommandId || headerCommandId || cryptoRandomCommandId()");
    expect(serverSource).toContain("commandId.length > 128");
    expect(serverSource).toContain('mode: "attach", lifeLinkId: attachedLifeLinkId');
    expect(serverSource).toContain('response.status(409).json({ error: "idempotency_key_conflict" })');
    expect(storeSource).toContain("existingEvent.qrId !== qrId || existingEvent.ownerId !== userId");
    expect(serverSource).not.toMatch(/command_id\s*:\s*commandId/);
  });

  it("pins the implemented data and media limits in reusable request and response schemas", () => {
    const document = parseStrictJson(readSource(contractPath));
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const configProperties = objectValue(objectValue(schemas.ConfigResponse, "ConfigResponse").properties, "config properties");
    expect(objectValue(configProperties.maxBatchCount, "maxBatchCount").const).toBe(10000);
    const patchProperties = objectValue(objectValue(schemas.LinkPatchRequest, "LinkPatchRequest").properties, "patch properties");
    expect(objectValue(patchProperties.title, "title").maxLength).toBe(120);
    expect(objectValue(patchProperties.body, "body").maxLength).toBe(4000);
    const mediaProperties = objectValue(objectValue(schemas.LinkMedia, "LinkMedia").properties, "media properties");
    expect(objectValue(mediaProperties.sizeBytes, "sizeBytes").maximum).toBe(25 * 1024 * 1024);
    expect(objectValue(mediaProperties.mimeType, "mimeType").enum).toEqual(Object.keys(ATTACHMENT_MIME_TYPES));
    expect(objectValue(mediaProperties.kind, "kind").enum).toEqual(["image", "video", "document"]);
    const linkProperties = objectValue(objectValue(schemas.Link, "Link").properties, "link properties");
    expect(objectValue(linkProperties.media, "media").maxItems).toBe(8);
    const loginProperties = objectValue(objectValue(schemas.LoginResponse, "LoginResponse").properties, "login properties");
    expect(objectValue(loginProperties.sessionToken, "sessionToken")).toMatchObject({
      readOnly: true,
      minLength: 32,
      maxLength: 256
    });
    expect(objectValue(loginProperties.sessionToken, "sessionToken")).not.toHaveProperty("writeOnly");
    const findProperties = objectValue(objectValue(schemas.FindScanResponse, "FindScanResponse").properties, "find properties");
    const scannedAlternatives = objectValue(findProperties.scannedQrId, "scannedQrId").oneOf as JsonObject[];
    expect(scannedAlternatives[0]).toMatchObject({ type: "string", minLength: 1, maxLength: 2048 });
    expect(scannedAlternatives[0]).not.toHaveProperty("$ref");
  });

  it("publishes source-bound image query modes and a separately bounded visual payload", () => {
    const document = parseStrictJson(readSource(contractPath));
    const operation = operationById(contractOperations(document), "getLifeLinkAttachmentImage");
    expect(operation.security).toBeUndefined();
    const parameters = operation.parameters as JsonObject[];
    expect(parameters.find((parameter) => parameter.name === "mode")).toMatchObject({ required: true, schema: { enum: ["describe", "overview", "crop"] } });
    expect(parameters.find((parameter) => parameter.name === "sourceRevision")).toMatchObject({ schema: { pattern: "^[a-f0-9]{64}$" } });
    expect(parameters.find((parameter) => parameter.name === "page")).toMatchObject({ required: false, schema: { type: "integer", minimum: 1, maximum: 512 } });
    expect(parameters.find((parameter) => parameter.name === "maxEdge")).toMatchObject({ schema: { maximum: ATTACHMENT_IMAGE_MAX_OUTPUT_EDGE } });
    const schemas = objectValue(objectValue(document.components, "components").schemas, "schemas");
    const properties = objectValue(objectValue(schemas.AttachmentImageResult, "AttachmentImageResult").properties, "image properties");
    const source = ((properties.source as JsonObject).anyOf as JsonObject[])[0];
    const sourceProperties = objectValue(source.properties, "source properties");
    expect(sourceProperties.pdf).toMatchObject({ additionalProperties: false, required: ["pageNumber", "pageCount", "rotation", "pixelsPerPoint"],
      properties: { pixelsPerPoint: { const: 4 }, pageCount: { maximum: 512 } } });
    expect(source.allOf).toMatchObject([
      { then: { required: ["pdf"] }, else: { not: { required: ["pdf"] } } },
      { then: { required: ["office"] }, else: { not: { required: ["office"] } } },
      { then: { required: ["video"] }, else: { not: { required: ["video"] } } },
      { if: { required: ["animation"] }, else: { properties: { frameCount: { const: 1 } } } }
    ]);
    expect((properties.reason as JsonObject).enum).toContain("encrypted");
    const image = objectValue(((properties.image as JsonObject).anyOf as JsonObject[])[0].properties, "image payload properties");
    expect(image.data).toMatchObject({ contentEncoding: "base64", maxLength: ATTACHMENT_IMAGE_MAX_BASE64_CHARS });
    const rendition = objectValue(((properties.rendition as JsonObject).anyOf as JsonObject[])[0].properties, "rendition properties");
    expect(rendition.sizeBytes).toMatchObject({ maximum: ATTACHMENT_IMAGE_MAX_BYTES });
    expect(rendition).toHaveProperty("sha256"); expect(rendition).toHaveProperty("region"); expect(rendition).toHaveProperty("processorVersion");
    expect(properties.status).toMatchObject({ enum: ["described", "bytes_ready", "unreadable"] });
    expect(parameters.find((p) => p.name === "frame")).toMatchObject({ schema: { minimum: 1, maximum: 512 } });
    expect(parameters.find((p) => p.name === "atMs")).toMatchObject({ schema: { minimum: 0, maximum: 300000 } });
    expect(sourceProperties.office).toMatchObject({ properties: { conversionProfile: { const: "cached-print-v1" } } });
    expect(sourceProperties.video).toMatchObject({ required: expect.arrayContaining(["framePts", "timeBase", "frameTimeMs", "requestedTimeMs"]) });
    expect(sourceProperties.animation).toMatchObject({ required: expect.arrayContaining(["frameNumber", "frameCount", "startMs", "durationMs", "loopCount"]) });
    expect((properties.reason as JsonObject).enum).toContain("runtime_unavailable");
    const text = operationById(contractOperations(document), "getLifeLinkAttachmentContent");
    expect((text.parameters as JsonObject[]).find((p) => p.name === "representation")).toMatchObject({ schema: { const: "transcript" } });
    expect((text.parameters as JsonObject[]).find((p) => p.name === "durationMs")).toMatchObject({ schema: { minimum: 1, maximum: 30000 } });
    const textProperties = objectValue(objectValue(schemas.AttachmentContentPage, "AttachmentContentPage").properties, "content properties");
    expect(textProperties.transcript).toMatchObject({ required: expect.arrayContaining(["nextStartMs", "audioStreamIndex", "modelSha256", "processorVersion"]) });
  });
});
