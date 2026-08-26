import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;
type HttpMethod = "get" | "post" | "patch" | "delete";

const HTTP_METHODS: HttpMethod[] = ["get", "post", "patch", "delete"];
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(testDirectory, "../../../contracts/http/openapi.json");
const passwordPath = path.resolve(testDirectory, "../src/password.ts");
const serverPath = path.resolve(testDirectory, "../src/server.ts");
const storePath = path.resolve(testDirectory, "../src/store.ts");
const webClientPath = path.resolve(testDirectory, "../../../apps/life-links-demo/src/api.ts");
const webControllerPath = path.resolve(testDirectory, "../../../apps/life-links-demo/src/workspace/controller.ts");

const EXPECTED_WEB_CLIENT_OPERATIONS = [
  "DELETE /api/life-links/{lifeLinkId}/media/{mediaId}",
  "DELETE /api/links/{qrId}/media/{mediaId}",
  "GET /api/config",
  "GET /api/life-links",
  "GET /api/life-links/search",
  "GET /api/life-links/{lifeLinkId}",
  "GET /api/links",
  "GET /api/me",
  "GET /api/projects",
  "GET /api/qr/{qrId}",
  "PATCH /api/life-links/{lifeLinkId}",
  "PATCH /api/life-links/{lifeLinkId}/parent",
  "PATCH /api/links/{qrId}",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/find/scan",
  "POST /api/life-links",
  "POST /api/life-links/{lifeLinkId}/media",
  "POST /api/links/{qrId}/media",
  "POST /api/projects",
  "POST /api/qr-batches",
  "POST /api/qr/{qrId}/claim"
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
    ...serverSource.matchAll(/app\.(get|post|patch|delete)\(\s*"([^"]+)"/g)
  ].map((match) => `${match[1].toUpperCase()} ${expressRouteToOpenApi(match[2])}`);
  const allRegistrations = [
    ...serverSource.matchAll(/app\.(get|post|patch|delete|put|head|options)\(/g)
  ];
  expect(
    allRegistrations.length,
    "every HTTP route registration must be a literal route or the one reviewed non-API browser fallback"
  ).toBe(literalRegistrations.length + 1);
  expect(serverSource).toContain("app.get(/^\\/(?!api\\/).*/,");
  return [
    ...literalRegistrations,
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
  return result.split("?", 1)[0];
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
    expect(published).toHaveLength(30);
    expect(published).toEqual(expect.arrayContaining(["GET /healthz", "GET /readyz", "GET /version"]));
    const operationIds = [...contractOperations(document).values()].map((operation) => operation.operationId);
    expect(new Set(operationIds).size).toBe(30);
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
      "store_mode"
    ]);
    const properties = objectValue(runtimeFields.properties, "RuntimeFields properties");
    expect(objectValue(properties.system, "runtime system").const).toBe("life_links");
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

  it("keeps the included web application client inside the published operation surface", () => {
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
      "updateOwnedLifeLink",
      "uploadLifeLinkMedia",
      "deleteLifeLinkMedia",
      "listLifeLinkProjects",
      "createLifeLinkProject",
      "createLifeLinkQrBatch",
      "downloadLifeLinkQrBatchCsv",
      "downloadLifeLinkQrBatchZip",
      "claimLifeLinkQr",
      "evaluateLifeLinkFindScan"
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

    const mutatingOperations = [...operations.entries()].filter(([key]) => /^(POST|PATCH|DELETE) /.test(key));
    for (const [key, operation] of mutatingOperations) {
      const parameters = (operation.parameters ?? []) as JsonObject[];
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
      "life_link_already_tagged",
      "output_limit_exceeded"
    ]);

    const publicQr = operationById(operations, "resolveLifeLinkQr");
    expect(String(publicQr.description)).toContain("projectId to null");
    expect(String(publicQr.description)).toContain("never expose canonical Life Link identity");
    const publicLinkProperties = objectValue(objectValue(schemas.Link, "legacy Link").properties, "legacy Link properties");
    for (const field of ["lifeLinkId", "parentId", "ancestry", "children", "path", "hierarchy", "rootId", "descendants"]) {
      expect(publicLinkProperties, `public compatibility Link must omit ${field}`).not.toHaveProperty(field);
    }
    expect(objectValue(schemas.QrPrivateState, "private QR state").required).toEqual(["state", "qrId"]);
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
    expect(objectValue(mediaProperties.mimeType, "mimeType").enum).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
      "video/quicktime"
    ]);
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
});
