import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Loader,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowBackUp,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBulb,
  IconCheck,
  IconChecklist,
  IconChevronRight,
  IconCopy,
  IconLanguage,
  IconListDetails,
  IconMoodSmile,
  IconPencil,
  IconPlayerStop,
  IconRefresh,
  IconRowInsertBottom,
  IconSend,
  IconSparkles,
  IconTextGrammar,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { useAtom, useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { htmlToMarkdown, markdownToHtml } from "@docmost/editor-ext";
import { notifications } from "@mantine/notifications";
import { showAiMenuAtom } from "@/features/editor/atoms/editor-atoms";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { streamAiGenerate } from "@/features/ai/services/ai-service.ts";
import {
  AiAction,
  IAiGenerateRequest,
} from "@/features/ai/types/ai.types.ts";
import {
  onOpenEditorAiMenu,
  setEditorAiAvailable,
} from "@/features/ai/components/editor-ai-bridge.ts";
import classes from "./editor-ai-menu.module.css";

const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Polish",
  "Russian",
  "Ukrainian",
  "Turkish",
  "Arabic",
  "Hindi",
  "Chinese (Simplified)",
  "Japanese",
  "Korean",
];

const TONES = ["professional", "casual", "friendly", "confident", "direct"];

type Range = { from: number; to: number };

type Props = { editor: Editor; pageId?: string };

/** Serialize a document range to Markdown for the model. */
function rangeToMarkdown(editor: Editor, range: Range): string {
  const slice = editor.state.doc.slice(range.from, range.to);
  const serializer = DOMSerializer.fromSchema(editor.schema);
  const div = document.createElement("div");
  div.appendChild(serializer.serializeFragment(slice.content));
  return htmlToMarkdown(div.innerHTML).trim();
}

async function markdownToSafeHtml(markdown: string): Promise<string> {
  return DOMPurify.sanitize(await markdownToHtml(markdown));
}

export function EditorAiMenu({ editor, pageId }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useAtom(showAiMenuAtom);
  const workspace = useAtomValue(workspaceAtom);
  const enabled = workspace?.settings?.ai?.generative === true;

  const [range, setRange] = useState<Range | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [resultHtml, setResultHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastRequest, setLastRequest] = useState<IAiGenerateRequest | null>(
    null,
  );
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditorAiAvailable(enabled);
    return () => setEditorAiAvailable(false);
  }, [enabled]);

  useEffect(() => onOpenEditorAiMenu(() => enabled && setOpen(true)), [enabled, setOpen]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
    setPrompt("");
    setResult("");
    setResultHtml("");
    setLoading(false);
    setLastRequest(null);
    setRange(null);
  }, [setOpen]);

  // Capture the selection and place the panel when it opens.
  useEffect(() => {
    if (!open || !editor) return;
    const { from, to } = editor.state.selection;
    setRange({ from, to });
    setSelectedText(from === to ? "" : rangeToMarkdown(editor, { from, to }));

    const container = editor.view.dom.closest(".editor-container");
    const coords = editor.view.coordsAtPos(to);
    const rect = container?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: coords.bottom - rect.top + 8,
        left: Math.max(0, Math.min(coords.left - rect.left, rect.width - 460)),
      });
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, editor]);

  // Keep the preview in sync with the streamed Markdown.
  useEffect(() => {
    let cancelled = false;
    markdownToSafeHtml(result).then((html) => {
      if (!cancelled) setResultHtml(html);
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target)) return;
      // Mantine menus render in a portal.
      if (target.closest("[data-ai-menu-dropdown]")) return;
      if (!loading && !result) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, loading, result, close]);

  const run = async (request: IAiGenerateRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLastRequest(request);
    setResult("");
    setLoading(true);
    try {
      await streamAiGenerate(
        { ...request, text: selectedText, pageId },
        (text) => setResult(text),
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        notifications.show({
          message: (err as Error).message || t("AI request failed"),
          color: "red",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const runAction = (action: AiAction, extra: Partial<IAiGenerateRequest> = {}) =>
    run({ action, ...extra });

  const submitPrompt = () => {
    if (!prompt.trim()) return;
    run({ action: "custom", prompt: prompt.trim() });
  };

  const insertResult = async (mode: "replace" | "below") => {
    if (!range || !result.trim()) return;
    const html = await markdownToSafeHtml(result.trim());
    const chain = editor.chain().focus();
    if (mode === "replace" && range.from !== range.to) {
      chain.insertContentAt(range, html).run();
    } else {
      // Insert after the block that holds the end of the selection.
      const $to = editor.state.doc.resolve(range.to);
      const pos = $to.depth > 0 ? $to.after(1) : range.to;
      chain.insertContentAt(pos, html).run();
    }
    close();
  };

  const copyResult = async () => {
    await navigator.clipboard.writeText(result);
    notifications.show({ message: t("Copied") });
  };

  const hasSelection = !!selectedText;
  const actions = useMemo(
    () =>
      hasSelection
        ? [
            { action: "improve" as const, label: t("Improve writing"), icon: IconWand },
            { action: "fix_grammar" as const, label: t("Fix spelling and grammar"), icon: IconTextGrammar },
            { action: "shorter" as const, label: t("Make shorter"), icon: IconArrowsMinimize },
            { action: "longer" as const, label: t("Make longer"), icon: IconArrowsMaximize },
            { action: "simplify" as const, label: t("Simplify language"), icon: IconPencil },
            { action: "summarize" as const, label: t("Summarize"), icon: IconListDetails },
            { action: "explain" as const, label: t("Explain"), icon: IconBulb },
            { action: "action_items" as const, label: t("Extract action items"), icon: IconChecklist },
          ]
        : [
            { action: "continue" as const, label: t("Continue writing"), icon: IconPencil },
            { action: "summarize" as const, label: t("Summarize this page"), icon: IconListDetails },
            { action: "action_items" as const, label: t("Extract action items from page"), icon: IconChecklist },
          ],
    [hasSelection, t],
  );

  if (!open || !enabled) return null;

  return (
    <Paper
      ref={panelRef}
      className={classes.panel}
      shadow="lg"
      radius="md"
      withBorder
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-label={t("Ask AI")}
    >
      {(result || loading) && (
        <Box className={classes.result}>
          <ScrollArea.Autosize mah={320}>
            {result ? (
              <div
                className={classes.preview}
                dangerouslySetInnerHTML={{ __html: resultHtml }}
              />
            ) : (
              <Group gap="xs" p="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  {t("Writing...")}
                </Text>
              </Group>
            )}
          </ScrollArea.Autosize>
        </Box>
      )}

      <Group gap={6} wrap="nowrap" p={6}>
        <IconSparkles size={18} className={classes.sparkle} />
        <TextInput
          ref={inputRef}
          variant="unstyled"
          style={{ flex: 1 }}
          placeholder={
            result
              ? t("Tell AI what to change...")
              : hasSelection
                ? t("Ask AI to edit the selection...")
                : t("Ask AI to write something...")
          }
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitPrompt();
            }
          }}
          disabled={loading}
        />
        {loading ? (
          <ActionIcon
            variant="subtle"
            onClick={() => abortRef.current?.abort()}
            aria-label={t("Stop")}
          >
            <IconPlayerStop size={16} />
          </ActionIcon>
        ) : (
          <ActionIcon
            variant="filled"
            onClick={submitPrompt}
            disabled={!prompt.trim()}
            aria-label={t("Send")}
          >
            <IconSend size={16} />
          </ActionIcon>
        )}
      </Group>

      {result && !loading ? (
        <Group gap={6} p={6} pt={0}>
          {hasSelection && (
            <Button size="xs" leftSection={<IconCheck size={14} />} onClick={() => insertResult("replace")}>
              {t("Replace selection")}
            </Button>
          )}
          <Button
            size="xs"
            variant={hasSelection ? "default" : "filled"}
            leftSection={<IconRowInsertBottom size={14} />}
            onClick={() => insertResult("below")}
          >
            {t("Insert below")}
          </Button>
          <ActionIcon variant="default" onClick={copyResult} aria-label={t("Copy")}>
            <IconCopy size={14} />
          </ActionIcon>
          <ActionIcon
            variant="default"
            onClick={() => lastRequest && run(lastRequest)}
            aria-label={t("Try again")}
          >
            <IconRefresh size={14} />
          </ActionIcon>
          <Box style={{ flex: 1 }} />
          <ActionIcon variant="subtle" color="gray" onClick={close} aria-label={t("Discard")}>
            <IconX size={14} />
          </ActionIcon>
        </Group>
      ) : (
        !loading && (
          <Stack gap={0} p={4} pt={0}>
            {actions.map((a) => (
              <UnstyledButton
                key={a.action}
                className={classes.item}
                onClick={() => runAction(a.action)}
              >
                <a.icon size={16} />
                <Text size="sm">{a.label}</Text>
              </UnstyledButton>
            ))}
            {hasSelection && (
              <>
                <SubMenu
                  label={t("Change tone")}
                  icon={IconMoodSmile}
                  items={TONES.map((tone) => ({
                    label: t(tone.charAt(0).toUpperCase() + tone.slice(1)),
                    onClick: () => runAction("tone", { tone }),
                  }))}
                />
                <SubMenu
                  label={t("Translate")}
                  icon={IconLanguage}
                  items={LANGUAGES.map((language) => ({
                    label: language,
                    onClick: () => runAction("translate", { language }),
                  }))}
                />
              </>
            )}
            <UnstyledButton className={classes.item} onClick={close}>
              <IconArrowBackUp size={16} />
              <Text size="sm" c="dimmed">
                {t("Close")}
              </Text>
            </UnstyledButton>
          </Stack>
        )
      )}
    </Paper>
  );
}

function SubMenu({
  label,
  icon: Icon,
  items,
}: {
  label: string;
  icon: typeof IconLanguage;
  items: { label: string; onClick: () => void }[];
}) {
  return (
    <Menu position="right-start" trigger="hover" offset={4} withinPortal>
      <Menu.Target>
        <UnstyledButton className={classes.item}>
          <Icon size={16} />
          <Text size="sm" style={{ flex: 1 }}>
            {label}
          </Text>
          <IconChevronRight size={14} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown data-ai-menu-dropdown mah={320} style={{ overflowY: "auto" }}>
        {items.map((item) => (
          <Menu.Item key={item.label} onClick={item.onClick}>
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
