Here’s an expanded table of CLI coding agents with the Command, ENV_URL_NAME, and ENV_TOKEN_NAME conventions they use (based on docs and community usage).

Name	Command	ENV_URL_NAME	ENV_TOKEN_NAME
Claude Code	claude	ANTHROPIC_API_URL	ANTHROPIC_API_KEY
OpenAI Codex	codex	OPENAI_API_BASE	OPENAI_API_KEY
Gemini CLI	gemini	GOOGLE_API_URL	GOOGLE_API_KEY
Aider	aider	OPENAI_API_BASE	OPENAI_API_KEY
Cline	cline	OPENAI_API_BASE	OPENAI_API_KEY
ForgeCode	forge	OPENAI_API_BASE	OPENAI_API_KEY
Amazon Q Dev	awsq	AWS_API_ENDPOINT	AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
Warp AI CLI	warp	(built-in, no URL)	OPENAI_API_KEY (defaults)
Ollama (local LLM runner with agent CLI features)	ollama	(local, no URL)	(no token needed, runs models locally)
LlamaIndex CLI	llama	OPENAI_API_BASE (or provider-specific)	OPENAI_API_KEY (or provider-specific)


⸻

🔑 Notes & conventions:
	•	Most open-source agentic CLIs (Aider, Cline, ForgeCode) are OpenAI-first but can often be reconfigured for Anthropic, Gemini, etc., by swapping env vars.
	•	Gemini CLI is still new: its official repo uses GOOGLE_API_KEY and may not always require a separate URL (defaults to Google endpoints).
	•	Amazon Q Developer CLI ties into AWS SDK conventions, so it inherits AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.
	•	Warp CLI uses embedded AI agents; in many setups it defaults to OPENAI_API_KEY.
	•	Ollama is local-first, so no API token needed—great for fully offline dev agents.
	•	LlamaIndex CLI is more of a dev tool, but has agent CLI workflows; its envs depend on provider (OpenAI, Anthropic, etc.).

Would you like me to normalize this table (e.g. always provide ENV_URL_NAME/ENV_TOKEN_NAME even for local agents like Ollama, with “N/A” where not applicable), so it’s easier to consume programmatically?

—

See also: the External CLI Adapter in README (section “External CLI Adapter (adding new wrappers)”) for how this project maps these conventions when spawning third‑party CLIs.