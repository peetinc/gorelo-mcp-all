export type OAParam = {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: OASchema;
  style?: string;
  explode?: boolean;
};

export type OASchema = {
  type?: string;
  properties?: Record<string, OASchema>;
  required?: string[];
  items?: OASchema;
  enum?: unknown[];
  description?: string;
  format?: string;
  $ref?: string;
  oneOf?: OASchema[];
  anyOf?: OASchema[];
  allOf?: OASchema[];
  nullable?: boolean;
};

export type OARequestBody = {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: OASchema }>;
};

export type OAOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OAParam[];
  requestBody?: OARequestBody;
  responses?: Record<string, unknown>;
};

export type OASpec = {
  openapi?: string;
  swagger?: string;
  servers?: { url: string }[];
  basePath?: string;
  host?: string;
  paths: Record<string, Record<string, OAOperation>>;
  components?: {
    schemas?: Record<string, OASchema>;
    securitySchemes?: Record<string, unknown>;
  };
  definitions?: Record<string, OASchema>;
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method: string;
  pathTemplate: string;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  bodyParam?: string;
  bodyContentType?: string;
  tags: string[];
  synthetic?: boolean;
};
