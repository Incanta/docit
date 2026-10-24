import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { generateText, streamText } from 'ai';
import { Workspace } from '@docmost/db/types/entity.types';
import { AiProviderService } from './providers/ai-provider.service';
import { RetrievalService, RetrievedSource } from './answers/retrieval.service';
import { AiAction } from './dto/ai.dto';

export function isGenerativeAiEnabled(workspace: Workspace): boolean {
  return (workspace.settings as any)?.ai?.generative === true;
}

export function isAiSearchOn(workspace: Workspace): boolean {
  return (workspace.settings as any)?.ai?.search === true;
}

const EDIT_SYSTEM = `You are a writing assistant inside DocIt, a team knowledge base.
You transform the text the user gives you according to their instruction.
Rules:
- Return only the resulting text, formatted as Markdown. No preamble, no explanations, no surrounding quotes or code fences.
- Preserve the meaning, facts, links, and Markdown structure (headings, lists, tables, code) unless the instruction asks otherwise.
- Keep the original language unless asked to translate.`;

const ACTION_PROMPTS: Record<Exclude<AiAction, 'custom'>, (o: { language?: string; tone?: string }) => string> = {
  improve: () => 'Improve the writing: make it clearer and better structured while keeping the meaning.',
  fix_grammar: () => 'Fix spelling, grammar, and punctuation. Change nothing else.',
  shorter: () => 'Make it shorter and more concise without losing key information.',
  longer: () => 'Expand it with more detail and explanation, staying consistent with the original.',
  simplify: () => 'Rewrite it in simpler language that is easy to understand.',
  tone: ({ tone }) => `Rewrite it in a ${tone || 'professional'} tone.`,
  translate: ({ language }) => {
    if (!language) throw new BadRequestException('language is required for translate');
    return `Translate it into ${language}. Keep Markdown formatting, code, and proper nouns intact.`;
  },
  summarize: () => 'Summarize it in a few sentences or bullet points.',
  continue: () =>
    'Continue writing from where the text ends, matching its style and tone. Return only the new continuation, not the original text.',
  explain: () => 'Explain what this text means in plain language.',
  action_items: () => 'Extract the action items as a Markdown task list (- [ ] item).',
};

const ANSWER_SYSTEM = `You answer questions using a team's knowledge base in DocIt.
Use only the numbered sources provided in the user message. Each source is a page excerpt.
- Cite sources inline with their number in square brackets, like [1] or [2][3], right after the statements they support.
- If the sources do not contain the answer, say you could not find it in the knowledge base. Do not use outside knowledge to fill gaps.
- Be concise and use Markdown formatting where it helps (lists, short headings, code).
- Answer in the language of the question.`;

@Injectable()
export class AiService {
  constructor(
    private readonly aiProvider: AiProviderService,
    private readonly retrieval: RetrievalService,
  ) {}

  assertGenerative(workspace: Workspace) {
    if (!isGenerativeAiEnabled(workspace)) {
      throw new ForbiddenException('AI writing is not enabled for this workspace');
    }
  }

  assertAiSearch(workspace: Workspace) {
    if (!isAiSearchOn(workspace)) {
      throw new ForbiddenException('AI answers are not enabled for this workspace');
    }
  }

  buildEditPrompt(opts: {
    action: AiAction;
    text?: string;
    prompt?: string;
    language?: string;
    tone?: string;
    context?: string;
  }): string {
    const custom = opts.prompt?.trim();
    if (opts.action === 'custom' && !custom) {
      throw new BadRequestException('prompt is required for custom actions');
    }
    const instruction =
      opts.action === 'custom' ? custom : ACTION_PROMPTS[opts.action](opts);

    const parts = [`Instruction: ${instruction}`];
    if (opts.action !== 'custom' && custom) {
      parts.push(`Extra guidance: ${custom}`);
    }
    if (opts.context) {
      parts.push(
        `Surrounding page content, for context only (do not repeat it):\n<page>\n${opts.context.slice(0, 20000)}\n</page>`,
      );
    }
    parts.push(
      opts.text?.trim()
        ? `Text:\n<text>\n${opts.text}\n</text>`
        : 'There is no selected text: write new content that follows the instruction.',
    );
    return parts.join('\n\n');
  }

  async generate(workspace: Workspace, prompt: string) {
    const model = await this.aiProvider.getChatModel(workspace.id);
    const { text } = await generateText({
      model,
      system: EDIT_SYSTEM,
      prompt,
      maxOutputTokens: 16000,
    });
    return text;
  }

  async streamGenerate(workspace: Workspace, prompt: string, signal?: AbortSignal) {
    const model = await this.aiProvider.getChatModel(workspace.id);
    return streamText({
      model,
      system: EDIT_SYSTEM,
      prompt,
      maxOutputTokens: 32000,
      abortSignal: signal,
    });
  }

  async prepareAnswer(opts: {
    workspace: Workspace;
    userId: string;
    question: string;
    spaceId?: string;
  }): Promise<{ sources: RetrievedSource[]; prompt: string | null }> {
    const { sources } = await this.retrieval.retrieve({
      query: opts.question,
      userId: opts.userId,
      workspaceId: opts.workspace.id,
      spaceId: opts.spaceId,
    });
    if (sources.length === 0) return { sources, prompt: null };

    const blocks = sources.map((s) => {
      const label = s.attachmentName
        ? `${s.title} (attachment: ${s.attachmentName})`
        : s.title;
      return `[${s.index}] ${label}${s.spaceName ? ` - space: ${s.spaceName}` : ''}\n${s.snippets.join('\n...\n')}`;
    });
    const prompt = `Sources:\n\n${blocks.join('\n\n---\n\n')}\n\nQuestion: ${opts.question}`;
    return { sources, prompt };
  }

  async streamAnswer(workspace: Workspace, prompt: string, signal?: AbortSignal) {
    const model = await this.aiProvider.getChatModel(workspace.id);
    return streamText({
      model,
      system: ANSWER_SYSTEM,
      prompt,
      maxOutputTokens: 16000,
      abortSignal: signal,
    });
  }

  async answer(workspace: Workspace, prompt: string) {
    const model = await this.aiProvider.getChatModel(workspace.id);
    const { text } = await generateText({
      model,
      system: ANSWER_SYSTEM,
      prompt,
      maxOutputTokens: 16000,
    });
    return text;
  }
}
