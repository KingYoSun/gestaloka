import { useRef, type ReactNode } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import { Popover, Toast } from "radix-ui";
import { Button } from "./components/ui/button.js";

const generationLabels = {
  preparing: "背景情報を生成中...",
  acting: "シーンの続きを生成中...",
  reflecting: "リザルトを生成中...",
};

export function GenerationStatus({
  phase,
}: {
  phase: keyof typeof generationLabels;
}) {
  const message = (
    <>
      <LoaderCircle
        aria-hidden="true"
        className="size-5 motion-safe:animate-spin"
      />
      {generationLabels[phase]}
    </>
  );
  return (
    <>
      {phase === "acting" && <p className="generation-status">{message}</p>}
      <Toast.Provider label="生成状況" duration={Infinity}>
        <Toast.Root key={phase} type="background" className="generation-toast">
          <Toast.Title className="generation-status">{message}</Toast.Title>
        </Toast.Root>
        <Toast.Viewport
          className="generation-viewport"
          label="生成状況の通知 ({hotkey})"
        />
      </Toast.Provider>
    </>
  );
}

export function InputPopover({
  open,
  onOpenChange,
  onSubmit,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const composing = useRef(false);
  return (
    <Popover.Root open={open && !disabled} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button
          className="scene-pencil"
          aria-label="自由入力"
          title="自由入力"
          disabled={disabled}
        >
          <Pencil className="size-6" aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label="自由入力"
          className="scene-composer"
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            const input = (event.currentTarget as HTMLElement).querySelector(
              "textarea",
            );
            if (input) {
              event.preventDefault();
              input.focus();
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!composing.current) onSubmit();
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.target instanceof HTMLTextAreaElement &&
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing &&
                !composing.current &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                onSubmit();
              }
            }}
          >
            {children}
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
