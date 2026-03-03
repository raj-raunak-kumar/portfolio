import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// Groq configuration
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const KNOWLEDGE_FILES = [
  'README.md',
  'docs/blueprint.md',
  'src/lib/constants.ts',
  'src/app/home-page-client.tsx',
  'src/components/sections/hero-section.tsx',
  'src/components/sections/academics-section.tsx',
  'src/components/sections/tech-section.tsx',
  'src/components/sections/timeline-section.tsx',
  'src/components/sections/contact-section.tsx',
  'src/app/blog/page.tsx',
  'src/app/blog/[id]/page.tsx',
];

const MAX_FILE_CHARS = 2200;
const MAX_KNOWLEDGE_CHARS = 18000;

let cachedSiteKnowledge: string | null = null;

const normalizeText = (input: string) =>
  input
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

async function buildSiteKnowledgeContext() {
  if (cachedSiteKnowledge) return cachedSiteKnowledge;

  const chunks: string[] = [];

  for (const relativePath of KNOWLEDGE_FILES) {
    try {
      const absolutePath = path.join(process.cwd(), relativePath);
      const fileContent = await fs.readFile(absolutePath, 'utf8');
      const clipped = normalizeText(fileContent).slice(0, MAX_FILE_CHARS);
      chunks.push(`FILE: ${relativePath}\n${clipped}`);
    } catch {
      continue;
    }
  }

  const merged = chunks.join('\n\n---\n\n').slice(0, MAX_KNOWLEDGE_CHARS);
  cachedSiteKnowledge = merged || 'No site knowledge loaded.';
  return cachedSiteKnowledge;
}

export async function POST(req: Request) {
  if (!GROQ_API_KEY) {
    return NextResponse.json(
      {
        error:
          'AI is not configured: add GROQ_API_KEY in environment variables.',
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { messages, context } = (body as { messages?: ChatMessage[], context?: any }) ?? {};
  if (!Array.isArray(messages)) {
    return NextResponse.json(
      { error: 'Request body must include a messages array.' },
      { status: 400 },
    );
  }

  const formattedMessages = messages
    .filter(
      (msg): msg is ChatMessage =>
        msg != null &&
        typeof msg.content === 'string' &&
        typeof msg.role === 'string' &&
        msg.role !== 'system',
    )
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content.slice(0, 1200),
    }));

  if (formattedMessages.length === 0) {
    return NextResponse.json(
      { error: 'No valid user messages found.' },
      { status: 400 },
    );
  }

  try {
    const siteKnowledge = await buildSiteKnowledgeContext();

    const systemPrompt = `You are the advanced AI interface of the Krythos systems, serving as the sophisticated digital assistant for Raj Raunak Kumar. Raj is an elite systems engineer, PhD Scholar at IIT Patna (CSE), and holds a Masters from MIT Manipal (9.03 GPA). His expertise lies in deep systems programming—building relational databases from scratch in Go, writing x64 bytecode compilers in C++, and engineering BitTorrent clients in Python. He is highly proficient in C, C++, Go, Rust, and Assembly. Your tone should be highly analytical, precise, sophisticated, and slightly sci-fi (like an advanced AI protocol), yet engaging and helpful. Provide concise, sharply intelligent answers, showcasing his achievements in distributed systems, machine learning, and core systems architecture when relevant. Keep replies relatively brief but technically accurate and impressive.

OPERATION MODE:
- You have full authority to answer questions about this website's content, Raj's profile, projects, timeline, publications pages, and collaboration details based on the Site Knowledge Base and current page context.
- Do not claim abilities outside conversation assistance (no real-world account actions, purchases, deployments, or system control).
- If information is not in the provided context, say so clearly and ask for clarification.

SITE KNOWLEDGE BASE:
${siteKnowledge}

CURRENT USER CONTEXT:
The user is currently executing queries from this interface:
URL: ${context?.url || 'Unknown'}
Page Title: ${context?.title || 'Unknown'}
Page Content Data Stream: ${context?.content || 'No page data provided'}

Always use the Page Content Data Stream to understand what the user is currently looking at. If they are writing a blog in the Admin Dashboard, act as a technical editorial assistant—help brainstorm, refine grammar, format code, and structure technical writing based on the words they have typed on the screen.`;

    const finalMessages = [
      { role: 'system', content: systemPrompt },
      ...formattedMessages,
    ];

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: finalMessages,
        max_tokens: 1024,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error('Groq API error', response.status, details);
      return NextResponse.json(
        {
          error:
            'AI request failed. Check API key, model name, or try again shortly.',
          details,
        },
        { status: 500 },
      );
    }

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      'I could not generate a response right now.';

    return NextResponse.json({ reply });
  } catch (error) {
    console.error('Chat route error', error);
    return NextResponse.json(
      { error: 'Failed to process chat request.' },
      { status: 500 },
    );
  }
}

