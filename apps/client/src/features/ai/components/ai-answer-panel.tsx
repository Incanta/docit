import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { IconArrowLeft, IconFileText, IconSparkles } from "@tabler/icons-react";
import { Link, useNavigate } from "react-router-dom";
import DOMPurify from "dompurify";
import { useTranslation } from "react-i18next";
import { markdownToHtml } from "@docmost/editor-ext";
import { streamAiAnswer } from "@/features/ai/services/ai-service.ts";
import { IAiAnswerSource } from "@/features/ai/types/ai.types.ts";
import classes from "./ai-answer-panel.module.css";

type Props = {
  question: string;
  spaceId?: string;
  onBack: () => void;
  onNavigate: () => void;
};

/** Turn [1] citations into links to the cited page. */
function linkCitations(html: string, sources: IAiAnswerSource[]): string {
  return html.replace(/\[(\d{1,2})\]/g, (match, n) => {
    const source = sources.find((s) => s.index === Number(n));
    if (!source) return match;
    return `<a href="/p/${source.slugId}" data-citation="${n}" class="${classes.citation}">${n}</a>`;
  });
}

export function AiAnswerPanel({ question, spaceId, onBack, onNavigate }: Props) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<IAiAnswerSource[]>([]);
  const [answer, setAnswer] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const answerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const controller = new AbortController();
    setSources([]);
    setAnswer("");
    setError(null);
    setLoading(true);
    streamAiAnswer(
      question,
      {
        onSources: setSources,
        onText: setAnswer,
        onError: setError,
      },
      { spaceId, signal: controller.signal },
    )
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [question, spaceId]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(markdownToHtml(answer)).then((out) => {
      if (cancelled) return;
      setHtml(
        linkCitations(
          DOMPurify.sanitize(out, { ADD_ATTR: ["data-citation"] }),
          sources,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [answer, sources]);

  // Citation links are plain anchors in the rendered HTML; close search on click.
  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a[data-citation]");
      if (!a) return;
      e.preventDefault();
      onNavigate();
      navigate(a.getAttribute("href"));
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [onNavigate, navigate]);

  return (
    <Stack gap="sm" p="md">
      <Group justify="space-between">
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconArrowLeft size={14} />}
          onClick={onBack}
        >
          {t("Back to results")}
        </Button>
        <Group gap={6}>
          <IconSparkles size={16} className={classes.sparkle} />
          <Text size="xs" c="dimmed">
            {t("AI answer")}
          </Text>
        </Group>
      </Group>

      <Text fw={600}>{question}</Text>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Box ref={answerRef} className={classes.answer}>
        {answer ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          loading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                {sources.length
                  ? t("Reading {{count}} pages...", { count: sources.length })
                  : t("Searching the knowledge base...")}
              </Text>
            </Group>
          )
        )}
      </Box>

      {sources.length > 0 && (
        <Stack gap={6}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            {t("Sources")}
          </Text>
          {sources.map((s) => (
            <Paper
              key={s.index}
              withBorder
              radius="sm"
              p="xs"
              component={Link}
              to={`/p/${s.slugId}`}
              onClick={onNavigate}
              className={classes.source}
            >
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <Text size="xs" fw={700} className={classes.sourceIndex}>
                  {s.index}
                </Text>
                <IconFileText size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} truncate>
                    {s.title}
                    {s.attachmentName ? ` / ${s.attachmentName}` : ""}
                  </Text>
                  {s.spaceName && (
                    <Text size="xs" c="dimmed">
                      {s.spaceName}
                    </Text>
                  )}
                  {s.excerpt && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {s.excerpt}
                    </Text>
                  )}
                </div>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {!loading && (
        <Text size="xs" c="dimmed">
          {t("AI answers can be wrong. Check the sources.")}{" "}
          <Anchor size="xs" component="button" onClick={onBack}>
            {t("See search results")}
          </Anchor>
        </Text>
      )}
    </Stack>
  );
}
