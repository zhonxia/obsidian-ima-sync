import * as https from "https";

const BASE_HOST = "ima.qq.com";
const BASE_PORT = 443;

export interface ImaApiConfig {
  clientId: string;
  apiKey: string;
}

export interface ImportDocResult {
  note_id: string;
}

export interface AddKnowledgeResult {
  media_id: string;
}

export class ImaApiError extends Error {
  code: number;
  constructor(code: number, msg: string) {
    super(msg);
    this.code = code;
    this.name = "ImaApiError";
  }
}

export class ImaApi {
  private config: ImaApiConfig;

  constructor(config: ImaApiConfig) {
    this.config = config;
  }

  updateConfig(config: ImaApiConfig) {
    this.config = config;
  }

  private async post(path: string, body: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const options: https.RequestOptions = {
        hostname: BASE_HOST,
        port: BASE_PORT,
        path: `/${path}`,
        method: "POST",
        headers: {
          "ima-openapi-clientid": this.config.clientId,
          "ima-openapi-apikey": this.config.apiKey,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (json.code !== 0) {
              reject(new ImaApiError(json.code, json.msg || `API error (code ${json.code})`));
            } else {
              resolve(json.data);
            }
          } catch {
            reject(new ImaApiError(-1, `HTTP ${res.statusCode}: invalid response`));
          }
        });
      });

      req.on("error", (err) => {
        reject(new ImaApiError(-1, `Network error: ${err.message}`));
      });

      req.write(data);
      req.end();
    });
  }

  async importDoc(
    content: string,
    options?: { folderId?: string; folderName?: string }
  ): Promise<ImportDocResult> {
    const body: Record<string, unknown> = {
      content_format: 1,
      content,
    };
    if (options?.folderId) body.folder_id = options.folderId;
    if (options?.folderName) body.folder_name = options.folderName;

    return this.post("openapi/note/v1/import_doc", body);
  }

  async appendDoc(noteId: string, content: string): Promise<void> {
    await this.post("openapi/note/v1/append_doc", {
      note_id: noteId,
      content_format: 1,
      content,
    });
  }

  async listKnowledgeBases(): Promise<Array<{ id: string; name: string }>> {
    const data = await this.post("openapi/wiki/v1/get_addable_knowledge_base_list", {
      cursor: "",
      limit: 50,
    });
    return data.addable_knowledge_base_list || [];
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.post("openapi/note/v1/list_notebook", {
        cursor: "0",
        limit: 1,
      });
      return { ok: true, message: "Connection successful. Credentials are valid." };
    } catch (err) {
      if (err instanceof ImaApiError) {
        const msg =
          err.code === 20004
            ? "Authentication failed: invalid Client ID or API Key"
            : err.code === 110030
            ? "No permission. Check your API credentials."
            : `API error (${err.code}): ${err.message}`;
        return { ok: false, message: msg };
      }
      return { ok: false, message: `Network error: ${err.message}` };
    }
  }

  async addKnowledge(
    noteId: string,
    title: string,
    knowledgeBaseId: string,
    options?: { folderId?: string }
  ): Promise<AddKnowledgeResult> {
    const body: Record<string, unknown> = {
      media_type: 11,
      title,
      knowledge_base_id: knowledgeBaseId,
      note_info: { content_id: noteId },
    };
    if (options?.folderId) body.folder_id = options.folderId;

    return this.post("openapi/wiki/v1/add_knowledge", body);
  }
}
