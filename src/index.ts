import { DurableObject } from "cloudflare:workers";

type Budget = {
	members: number;
	duesPerMember: number;
	expenses: number;
}
type BudgetSummary = {
	members: number;
	duesPerMember: number;
	totalRevenue: number;
	expenses: number;
	balance: number;
}
function summarizeBudget(budget: Budget): BudgetSummary {
	const totalRevenue = budget.members * budget.duesPerMember;
	const expenses = budget.expenses;
	return {
		members: budget.members,
		duesPerMember: budget.duesPerMember,
		totalRevenue,
		expenses,
		balance: totalRevenue - expenses,
	};
}
function simulateBudget(
  budget: Budget,
  changes: Partial<{ members: number; duesPerMember: number; expenses: number; }>
): BudgetSummary {
  return summarizeBudget({
    members: changes.members ?? budget.members,
    duesPerMember: changes.duesPerMember ?? budget.duesPerMember,
    expenses: changes.expenses ?? budget.expenses,
  });
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}


const BUDGET_KEY = "budget";
export class MyDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async getBudget(): Promise<Budget | null> {
    const stored = await this.ctx.storage.get<Budget>(BUDGET_KEY);
    return stored ?? null;
  }

  private async saveBudget(budget: Budget): Promise<void> {
    await this.ctx.storage.put(BUDGET_KEY, budget);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 1) GET /budget → return current budget + summary
    if (url.pathname === "/budget" && method === "GET") {
      const budget = await this.ctx.storage.get<Budget>(BUDGET_KEY);

      if (!budget) {
        return new Response(
          JSON.stringify({ budget: null, summary: null }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      const summary = summarizeBudget(budget);

      return new Response(
        JSON.stringify({ budget, summary }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 2) POST /budget → set budget from structured JSON
    if (url.pathname === "/budget" && method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const members = Number(body.members);
      const duesPerMember = Number(body.duesPerMember);
      const expenses = Number(body.expenses);

      if (!Number.isFinite(members) || !Number.isFinite(duesPerMember) || !Number.isFinite(expenses)) {
        return new Response(
          JSON.stringify({
            error: "Expected JSON with numeric members, duesPerMember, and expenses",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const budget: Budget = { members, duesPerMember, expenses };
      await this.ctx.storage.put(BUDGET_KEY, budget);

      const summary = summarizeBudget(budget);

      return new Response(
        JSON.stringify({ budget, summary }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 3) POST /chat → LLM-powered budget assistant
    if (url.pathname === "/chat" && method === "POST") {
      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const userMessage = typeof body.message === "string" ? body.message : "(no message)";

      // Load current budget (may be null if not set yet)
      const budget = await this.getBudget();

      // Build a simple description of the budget to give the model context
      const budgetContext = budget
        ? (() => {
            const summary = summarizeBudget(budget);
            return `
Current chapter budget:
- Members: ${summary.members}
- Dues per member: ${summary.duesPerMember}
- Total revenue: ${summary.totalRevenue}
- Total expenses: ${summary.expenses}
- Balance (revenue - expenses): ${summary.balance}
`;
          })()
        : "No budget has been set yet. Ask the user for members, duesPerMember, and expenses.";

      const systemPrompt = `
You are an assistant helping a fraternity treasurer reason about their chapter budget.

You are given:
- A simple budget model with: members, duesPerMember, total expenses.
- A summary of the current budget.
- A user's question.

Your job:
- Explain the budget in clear, simple terms.
- If the user asks "what if" questions (change dues, change members, change expenses),
  explain the effect qualitatively using the numbers you are given.
- If no budget is set yet, ask the user for:
  - number of members
  - dues per member
  - total yearly expenses
Keep answers concise and focused on the financial impact.
`;

      // Call Workers AI (Llama 3.3 instruct-style model)
      const aiResult = await this.env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Budget context:\n${budgetContext}\n\nUser question: ${userMessage}` }
          ]
        }
      );

      // For text models, Workers AI returns { response: string, ... }
      const replyText = (aiResult as any).response ?? "Sorry, I could not generate a response.";

      // Optionally remember lastMessage for debugging/history
      await this.ctx.storage.put("lastMessage", userMessage);

      return new Response(
        JSON.stringify({ reply: replyText }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 4) POST /simulate → return new summary without saving
    if (url.pathname === "/simulate" && method === "POST") {
      const budget = await this.getBudget();
      if (!budget) {
        return new Response(
          JSON.stringify({ error: "Budget not set yet" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const body = await request.json().catch(() => ({})) as Record<string, unknown>;

      const changes: Partial<Budget> = {};

      if (body.members !== undefined) changes.members = Number(body.members);
      if (body.duesPerMember !== undefined) changes.duesPerMember = Number(body.duesPerMember);
      if (body.expenses !== undefined) changes.expenses = Number(body.expenses);

      const summary = simulateBudget(budget, changes);

      return new Response(
        JSON.stringify({ summary }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not Found in Durable Object", { status: 404 });
  }
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// CORS preflight for API routes
		if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
  			return new Response(null, {
        		status: 204,
        		headers: CORS_HEADERS,
      });
		}

		// Health check endpoint
		if (url.pathname === "/api/health") {
			return withCors( 
				new Response(JSON.stringify({ ok: true }),
				{ headers: { "Content-Type": "application/json" } }
			)
		);
		}
		const stub = env.MY_DURABLE_OBJECT.getByName("foo");

		
		if (url.pathname === "/api/budget") {
			// Forward budget requests to Durable Object
  			const internalUrl = new URL("http://do.internal/budget");
  			const doResp = await stub.fetch(
				new Request(internalUrl.toString(), {
					method: request.method,
					headers: request.headers,
					body: request.body
				})
			);
			return withCors(doResp);
		}
		

		// Chat endpoint → forwards to Durable Object
		if (url.pathname === "/api/chat" && request.method.toUpperCase() === "POST") {
			const internalUrl = new URL("http://do.internal/chat");
  			const doResp = await stub.fetch(
    			new Request(internalUrl.toString(), {
      				method: "POST",
      				headers: request.headers,
      				body: request.body,
    			})
  			);
  			return withCors(doResp);
		}

		// /api/simulate → forwards to DO /simulate
		if (url.pathname === "/api/simulate" && request.method === "POST") {
  			const internalUrl = new URL("http://do.internal/simulate");
  			const doResp = await stub.fetch(
				new Request(internalUrl.toString(), {
					method: "POST",
					headers: request.headers,
					body: request.body,
				})
			);
			return withCors(doResp);
		}
		return withCors(
			new Response("Not Found", { status: 404 })
		);
	},
} satisfies ExportedHandler<Env>;
