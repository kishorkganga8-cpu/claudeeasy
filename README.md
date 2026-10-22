# claudeeasy

A local Windows website that connects several API providers to Claude Code. Add one or more providers, select a model for each, and put them in fallback order.

## Start

1. Clone or download this repository. Install Node.js 18 or newer, then double-click **Start Website.cmd**. Keep its gateway window running. You can also run `npm start`.
2. Open `http://127.0.0.1:3848/`. Choose **Inception**, **Kilo Gateway**, **xKiro**, **Anthropic**, or **Custom compatible API**.
3. Paste that provider's API key. The site fetches its available models automatically. Pick a model and click **Add to fallback list**. Repeat for more providers.
4. The top route is primary. Use **Move up** and **Move down** to set fallback priority. Test each route using its **Test** button.
5. Click **Open Claude Code** to launch a new window. The window uses your primary model and tries subsequent routes if a provider fails. You can also run **Run Claude Code.cmd** from this same folder.

Claude Code itself must already be installed. The separate Windows ZIP package includes a bundled Node.js runtime.

## Provider endpoints

| Provider | Model discovery | Request format |
| --- | --- | --- |
| Inception | `/v1/chat/completions/models` | OpenAI Chat Completions |
| Kilo Gateway | `/api/v1/models` | OpenAI Chat Completions |
| xKiro | `/v1/models` | Anthropic Messages |
| Anthropic | `/v1/models` | Anthropic Messages |
| Custom | `<base URL>/models` | OpenAI Chat Completions or Anthropic Messages |

For custom APIs, enter a base URL that ends just before `/models` and `/chat/completions` or `/messages`. Remote custom endpoints must use HTTPS; local endpoints may use HTTP on loopback.

## Fallback and privacy

- The gateway listens only on `127.0.0.1:3848`. Claude Code receives a local gateway token, never a provider key. Local `data/` files are ignored by Git.
- Each provider key is saved in `data/providers.vault` with AES-256-GCM. The encryption key is in `data/vault.key` in the same folder. **Anyone who can read both files can decrypt the provider keys. Keep the extracted folder private.** The ZIP contains neither file.
- The gateway tries routes in order when a provider returns an error or no visible content. Once an Anthropic-format stream has started, it cannot switch providers mid-response.
- The initial model shown in Claude Code is the first route. A fallback response may come from a different model. Use the website to see and edit the exact order.
- Model catalogs can include models that a key cannot use. The **Test** button verifies a model with a short provider request, which may incur provider charges.
- The app does not modify or remove existing Claude Code, Claude Code Router, AI-Router, or other router installations.
- Inception's Mercury models accept text only. Image or document requests can fall back to another route.

## Troubleshooting

- If model discovery fails, check the provider choice and API key. For custom APIs, check the base URL and format.
- If Claude Code does not start, confirm `claude` is on PATH. The new terminal will show any launch error.
- If port 3848 is busy, stop the conflicting process. The provided scripts expect this port.

Official API references: [Inception](https://docs.inceptionlabs.ai/api-reference/models/list-chat-models), [Kilo](https://kilo.ai/docs/gateway/api-reference), [xKiro](https://docs.xkiro.com/api/overview/), [Anthropic](https://platform.claude.com/docs/en/api/models/list).
