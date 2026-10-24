import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { ActionIcon, Box, Text, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { IconTable, IconX } from "@tabler/icons-react";
import classes from "./base-embed.module.css";

// Databases (bases) are not part of DocIt. Documents that already contain an
// embedded base still load; the embed renders as a placeholder that editors
// can remove.
export function BaseEmbedView({ editor, deleteNode }: NodeViewProps) {
  const { t } = useTranslation();

  return (
    <NodeViewWrapper className={classes.handleGutter}>
      {editor.isEditable && (
        <div
          className={classes.controls}
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Tooltip label={t("Remove from page")} withArrow>
            <ActionIcon
              variant="default"
              size="sm"
              aria-label={t("Remove from page")}
              onClick={() => deleteNode()}
            >
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </div>
      )}
      <Box p="md" bg="var(--mantine-color-default-hover)" style={{ borderRadius: 8 }}>
        <Text c="dimmed" size="sm">
          <IconTable size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          {t("Embedded databases are not supported.")}
        </Text>
      </Box>
    </NodeViewWrapper>
  );
}
