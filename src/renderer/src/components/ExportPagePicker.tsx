import React from "react";
import { useTranslation } from "react-i18next";
import type {
  ChapterSnapshot,
  LibraryWorkSummary,
} from "../../../shared/libraryTypes";
import type { ExportSelectionMap } from "../lib/exportSelection";
import { PageSelectionPicker } from "./BinaryChapterPagePicker";

export type ExportPagePickerProps = {
  work: LibraryWorkSummary;
  currentChapter: ChapterSnapshot;
  currentPageId: string;
  selection: ExportSelectionMap;
  onChange: (next: ExportSelectionMap) => void;
};

export function ExportPagePicker({
  work,
  currentChapter,
  currentPageId,
  selection,
  onChange,
}: ExportPagePickerProps): React.JSX.Element {
  const { t } = useTranslation("components");
  return (
    <PageSelectionPicker
      work={work}
      currentChapter={currentChapter}
      currentPageId={currentPageId}
      selection={selection}
      onChange={onChange}
      pageMetadataOnly
      copy={{
        prompt: t("exportOptions.prompt"),
        currentChapter: t("exportOptions.currentChapter"),
        chapterSummary: (count) => t("exportOptions.chapterSummary", { count }),
        noSelectedPages: t("exportOptions.noSelectedPages"),
        selectionSummary: (chapterCount, pageCount) =>
          t("exportOptions.selectionSummary", { chapterCount, pageCount }),
      }}
    />
  );
}
