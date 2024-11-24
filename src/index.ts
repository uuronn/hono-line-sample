import type {
	MessageAPIResponseBase,
	TextMessage,
	WebhookEvent,
} from "@line/bot-sdk";
import { Hono } from "hono";

type Bindings = {
	CHANNEL_ACCESS_TOKEN: string;
	OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.get("*", (c) => c.text("Hello World!"));

app.post("/api/webhook", async (c) => {
	const data = await c.req.json();
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const events: WebhookEvent[] = (data as any).events;
	const accessToken: string = c.env.CHANNEL_ACCESS_TOKEN;
	const openaiKey: string = c.env.OPENAI_API_KEY;

	await Promise.all(
		events.map(async (event: WebhookEvent) => {
			try {
				await textEventHandler(event, accessToken, openaiKey);
			} catch (err: unknown) {
				if (err instanceof Error) {
					console.error(err);
				}
				return c.json({
					status: "error",
				});
			}
		}),
	);
	return c.json({ message: "ok" });
});

const textEventHandler = async (
	event: WebhookEvent,
	accessToken: string,
	openaiKey: string,
): Promise<MessageAPIResponseBase | undefined> => {
	if (event.type !== "message" || event.message.type !== "text") {
		return;
	}

	const { replyToken } = event;

	console.log("event", event);
	const openaiApiUrl = "https://api.openai.com/v1/chat/completions";

	const openaiRequestBody = {
		model: "gpt-4o",
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "issue",
				schema: {
					type: "object",
					properties: {
						question: {
							type: "string",
						},
						answer: {
							type: "string",
						},
						accepted_aliases: {
							type: "array",
							items: {
								type: "string",
							},
						},
					},
					required: ["question", "answer", "accepted_aliases"],
				},
			},
		},
		messages: [
			{
				role: "user",
				content: `
あなたはアニメや小説に詳しいクイズマスターです。次の条件を満たすクイズ問題を1問生成してください。

### 条件
1. 問題は簡潔に、物語のあらすじを説明する形にしてください。
2. 正解のタイトルをフルで指定してください。
3. 一般的に使われている略称（例: 「転スラ」「このすば」など）があれば、リストで出力してください。
4. 出力形式は以下の通りにしてください。

### 出力フォーマット（JSON）
{
  "question": "ここに問題文を記述",
  "answer": "ここに正解のフルタイトルを記述",
  "accepted_aliases": ["略称1", "略称2"]
}
`,
			},
		],
	};

	let openaiResponse: null | Response = null;

	try {
		openaiResponse = await fetch(openaiApiUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${openaiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(openaiRequestBody),
		});
	} catch (error) {
		console.error("openaiError", error);
	}

	console.log("openaiResponse %o", openaiResponse);

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	const openaiResponseData: any = await openaiResponse?.json();
	console.log("%o", openaiResponseData);

	const content =
		openaiResponseData.choices[0]?.message?.content || "生成に失敗しました。";

	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	let parsedResponse: any;
	try {
		parsedResponse = JSON.parse(content);
	} catch (error) {
		parsedResponse = {
			question: "応答を解析できませんでした。もう一度試してください。",
			answer: "",
			accepted_aliases: [],
		};
	}

	const response: TextMessage = {
		type: "text",
		text: `問題: ${parsedResponse.question}\n\n正解: ${
			parsedResponse.answer
		}\n\n略称: ${
			parsedResponse.accepted_aliases.length > 0
				? parsedResponse.accepted_aliases.join(", ")
				: "なし"
		}`,
	};

	await fetch("https://api.line.me/v2/bot/message/reply", {
		body: JSON.stringify({
			replyToken: replyToken,
			messages: [response],
		}),
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
	});
};

export default app;
