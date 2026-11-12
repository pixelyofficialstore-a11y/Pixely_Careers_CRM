import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fillTemplate, type TemplateVars } from "@shared/whatsapp-templates";
import { waLink } from "@shared/phone";

type Template = { id: number | null; kind: string; label: string; body: string; isActive: boolean };

/**
 * Phase 5: one tap opens WhatsApp (wa.me) with a filled-in message. Templates
 * come from Settings (or the built-in defaults until an admin saves them).
 * Nothing is sent by the CRM: the user reviews and sends inside WhatsApp.
 */
export function WhatsAppQuickReply({ phone, vars, size = "sm", label = "WhatsApp", testId = "button-whatsapp-quick" }: {
  phone: string | null | undefined; vars: TemplateVars; size?: "sm" | "default"; label?: string; testId?: string;
}) {
  const { data } = useQuery<{ source: string; templates: Template[] }>({ queryKey: ["/api/whatsapp-templates"], staleTime: 5 * 60 * 1000 });
  const templates = (data?.templates ?? []).filter(t => t.isActive);
  if (!phone || !waLink(phone)) return null;
  const open = (text?: string) => window.open(waLink(phone, text)!, "_blank", "noopener,noreferrer");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size={size} className="gap-1.5 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400" data-testid={testId}>
          <MessageCircle className="h-4 w-4" /> {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-slate-500">Opens WhatsApp with the message ready to send</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {templates.map(t => {
          const text = fillTemplate(t.body, vars);
          return (
            <DropdownMenuItem key={`${t.id ?? t.kind}-${t.label}`} onSelect={() => open(text)} className="flex-col items-start gap-0.5" data-testid={`menu-whatsapp-${t.kind}`}>
              <span className="font-medium">{t.label}</span>
              <span className="line-clamp-2 text-xs text-slate-500">{text}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => open()} data-testid="menu-whatsapp-blank">Open chat (no message)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
