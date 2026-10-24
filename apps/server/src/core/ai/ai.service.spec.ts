import { BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';

describe('AiService.buildEditPrompt', () => {
  const service = new AiService({} as any, {} as any);

  it('wraps the selected text and the action instruction', () => {
    const prompt = service.buildEditPrompt({
      action: 'fix_grammar',
      text: 'this are wrong',
    });
    expect(prompt).toContain('Fix spelling, grammar, and punctuation');
    expect(prompt).toContain('<text>\nthis are wrong\n</text>');
  });

  it('requires a language for translation', () => {
    expect(() =>
      service.buildEditPrompt({ action: 'translate', text: 'hi' }),
    ).toThrow(BadRequestException);
    expect(
      service.buildEditPrompt({
        action: 'translate',
        text: 'hi',
        language: 'German',
      }),
    ).toContain('Translate it into German');
  });

  it('uses the prompt as the instruction for custom actions', () => {
    expect(() => service.buildEditPrompt({ action: 'custom' })).toThrow(
      BadRequestException,
    );
    const prompt = service.buildEditPrompt({
      action: 'custom',
      prompt: 'Write a haiku about docs',
    });
    expect(prompt).toContain('Instruction: Write a haiku about docs');
    expect(prompt).toContain('There is no selected text');
  });

  it('adds extra guidance and page context to built-in actions', () => {
    const prompt = service.buildEditPrompt({
      action: 'shorter',
      text: 'long text',
      prompt: 'keep the numbers',
      context: 'Page body',
    });
    expect(prompt).toContain('Extra guidance: keep the numbers');
    expect(prompt).toContain('<page>\nPage body\n</page>');
  });
});
