To use the same OAuth (or authentication) method as Codex for your own API calls, you have two main approaches based on what Codex supports:

---

### 1. Using an OpenAI API Key (Usage-based Billing)

This is the simplest approach and is documented in [`docs/authentication.md`](https://github.com/openai/codex/blob/881c7978f1362b7eb4009777d0907fdc7e81b4e3/docs/authentication.md):

````markdown
If you prefer to pay-as-you-go, you can authenticate with your OpenAI API key:
```shell
codex login --api-key "your-api-key-here"
```
This key must, at minimum, have write access to the Responses API.
````

For your own calls:
- Pass your OpenAI API key in the `Authorization` header as `Bearer <your-api-key>` when making HTTP requests to the OpenAI API (e.g., `https://api.openai.com/v1/...`).

**Example in curl:**
```bash
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

### 2. Using OAuth/ChatGPT Login (for ChatGPT plans)

If you want to authenticate using the same OAuth flow as Codex (e.g., for ChatGPT Plus/Pro/Enterprise plans), Codex uses an OAuth/OpenID flow to get an access token and account ID, which it then uses in API requests.

**Key points from the code:**
- Codex launches a login server and performs an OAuth flow to obtain an `id_token` and `access_token` (see [`login/src/server.rs`](https://github.com/openai/codex/blob/881c7978f1362b7eb4009777d0907fdc7e81b4e3/codex-rs/login/src/server.rs)).
- It then uses the access token as a Bearer token and includes the `chatgpt-account-id` header when calling ChatGPT backend endpoints.

**API Call Example (from [`chatgpt_client.rs`](https://github.com/openai/codex/blob/881c7978f1362b7eb4009777d0907fdc7e81b4e3/codex-rs/chatgpt/src/chatgpt_client.rs)):**
```rust
let response = client
    .get(&url)
    .bearer_auth(&token.access_token)
    .header("chatgpt-account-id", account_id?)
    /*...*/
```

So, to mimic Codex's approach:
1. Implement the OAuth login flow to obtain an `access_token` and `account_id` (Codex uses a local server and exchanges tokens).
2. Use the `access_token` as a Bearer token in your API requests.
3. Add the `chatgpt-account-id` header with the account ID.

---

### **Summary Table**

| Method          | How Codex Does It        | How You Can Do It Yourself             |
|-----------------|-------------------------|----------------------------------------|
| API Key         | `codex login --api-key` | Use `Authorization: Bearer <api-key>`  |
| OAuth/ChatGPT   | OAuth, get token, call  | Implement OAuth, use access token,     |
|                 | ChatGPT backend w/      | add `chatgpt-account-id` header        |
|                 | access_token + account_id|                                        |

---

**References in Code:**
- [`docs/authentication.md`](https://github.com/openai/codex/blob/881c7978f1362b7eb4009777d0907fdc7e81b4e3/docs/authentication.md)
- [`chatgpt_client.rs`](https://github.com/openai/codex/blob/881c7978f1362b7eb4009777d0907fdc7e81b4e3/codex-rs/chatgpt/src/chatgpt_client.rs)
- [`login/src/server.rs`](https://github.com/openai/codex/blob/881c7978f1362b7eb4009777d0907fdc7e81b4e3/codex-rs/login/src/server.rs)

If you need to implement the OAuth flow yourself, you'll need to follow the OpenAI/ChatGPT OAuth docs and handle token exchange as Codex does. If using an API key suffices, that's much simpler. Let me know if you want detailed steps for the OAuth flow!