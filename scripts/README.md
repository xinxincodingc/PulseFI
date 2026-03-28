# SCRIPTS FOLDER README

### generate_recommendations.py
1. Generated 3 personalised recommendations per user (~2000 users) using Gemini Flash Lite
2. Saved outputs in recommendations.json (to be later served alongside index.html)

### generate_users_json_for_frontend.py
1. Convert excel data into users.json keeping just the fields we need for dashboarding purposes
2. Purpose is to make UI dashboarding data dynamic and high latency


### Prompting approach (designed to match product UX + production constraints):

1. Goal-driven generation → infer user priorities (e.g. debt, savings, investing) so each card maps to a distinct actionable insight
2. UI-aligned structure enforcement → model outputs exactly match card schema (title, status, description, CTAs), so it plugs directly into the prototype
3. State abstraction layer → convert raw scores → human terms (“low savings”, “strong net worth”) to avoid exposing internal metrics and improve UX
4. Deterministic status mapping → financial health → URGENT / READY / ON TRACK to ensure consistency with visual design + badges
5. Personalisation grounded in real data → inject actual £ amounts into copy 
6. Tone + safety guardrails → no hype/unsafe language, concise + actionable, prevents hallucinated or misleading advice
7. 
Production mimic → batch generation ensures low latency, cost control, and stable outputs (vs real-time LLM calls)