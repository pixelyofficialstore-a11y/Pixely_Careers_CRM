import { useEffect, useRef, useState, type DragEvent, type ClipboardEvent } from "react";
import { FileImage, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type ImageDropzoneProps = {
  value?: File | null;
  values?: File[];
  onFile?: (file: File) => void;
  onFiles?: (files: File[]) => void;
  accept?: string;
  maxSizeMb?: number;
  maxFiles?: number;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  compact?: boolean;
  testId?: string;
  listenForPaste?: boolean;
};

function acceptedFile(file: File, accept: string) {
  if (!file.type) return true;
  return accept.split(",").some(entry => {
    const rule = entry.trim().toLowerCase();
    return rule.endsWith("/*")
      ? file.type.toLowerCase().startsWith(rule.slice(0, -1))
      : file.type.toLowerCase() === rule;
  });
}

export function ImageDropzone({
  value,
  values = [],
  onFile,
  onFiles,
  accept = "image/png,image/jpeg,image/webp",
  maxSizeMb = 5,
  maxFiles = 1,
  label = "Choose an image",
  description = "or paste / drag an image here",
  disabled = false,
  className,
  inputClassName,
  compact = false,
  testId,
  listenForPaste = false,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { toast } = useToast();

  const selectFiles = (incoming: File[]) => {
    if (disabled || incoming.length === 0) return;
    const validFiles = incoming.filter(file => {
      if (!acceptedFile(file, accept)) {
        toast({ title: "Image not accepted", description: "Please choose a supported image format.", variant: "destructive" });
        return false;
      }
      if (file.size > maxSizeMb * 1024 * 1024) {
        toast({ title: "Image is too large", description: `Use an image up to ${maxSizeMb}MB.`, variant: "destructive" });
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;
    const limitedFiles = validFiles.slice(0, maxFiles);
    if (validFiles.length > maxFiles) {
      toast({ title: "Maximum images reached", description: `You can add up to ${maxFiles} images here.`, variant: "destructive" });
    }
    if (onFiles) onFiles(limitedFiles);
    else onFile?.(limitedFiles[0]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    selectFiles(Array.from(event.dataTransfer.files || []));
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const imageItem = Array.from(event.clipboardData.items).find(item => item.type.startsWith("image/"));
    const image = imageItem?.getAsFile() || Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    selectFiles(image ? [image] : []);
  };

  useEffect(() => {
    if (!listenForPaste || disabled) return;
    const handleDocumentPaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items || []).find(item => item.type.startsWith("image/"));
      const image = imageItem?.getAsFile() || Array.from(event.clipboardData?.files || []).find(file => file.type.startsWith("image/"));
      if (!image) return;
      event.preventDefault();
      selectFiles([image]);
    };
    document.addEventListener("paste", handleDocumentPaste);
    return () => document.removeEventListener("paste", handleDocumentPaste);
  }, [accept, disabled, listenForPaste, maxFiles, maxSizeMb, onFile, onFiles]);

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-slate-700 bg-slate-950/60",
        dragging && "border-blue-400 bg-blue-500/10",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
      data-testid={testId}
      onDragEnter={event => { event.preventDefault(); setDragging(true); }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={handleDrop}
       onPaste={listenForPaste ? undefined : handlePaste}
      onClick={() => { if (!disabled) inputRef.current?.click(); }}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={event => {
        if ((event.key === "Enter" || event.key === " ") && !disabled) inputRef.current?.click();
      }}
      role="button"
      aria-label={`${label}. You can also paste or drag an image here.`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        disabled={disabled}
        className={cn("sr-only", inputClassName)}
        onChange={event => {
          selectFiles(Array.from(event.target.files || []));
          event.currentTarget.value = "";
        }}
      />
      <div className={cn("flex items-center gap-3 p-3 text-sm text-slate-400", compact && "p-2")}>
        {compact ? <Upload className="h-4 w-4 shrink-0 text-blue-400" /> : <FileImage className="h-5 w-5 shrink-0 text-blue-400" />}
        <span className="min-w-0">
           <span className="block truncate text-slate-300">{values.length ? `${values.length} image${values.length === 1 ? "" : "s"} selected` : value ? `Selected: ${value.name}` : label}</span>
          <span className="block text-xs text-slate-500">{description}</span>
        </span>
        <span className="ml-auto shrink-0 text-xs text-blue-300">Choose</span>
      </div>
    </div>
  );
}