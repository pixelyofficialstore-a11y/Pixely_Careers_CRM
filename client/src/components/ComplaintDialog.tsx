import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { complaintCategories, type OrderWithServices } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export const complaintCategoryLabels: Record<(typeof complaintCategories)[number], string> = {
  communication_issue: "Communication Issue",
  slow_response: "Slow Response",
  delivery_delay: "Delivery Delay",
  work_quality_issue: "Work Quality Issue",
  instructions_not_followed: "Instructions Not Followed",
  revision_handling_issue: "Revision Handling Issue",
  incorrect_information: "Incorrect Information Provided",
  unprofessional_behavior: "Unprofessional Behavior",
  process_policy_violation: "Process / Policy Violation",
  unauthorized_commitment: "Unauthorized Commitment",
  other: "Other",
};

type ComplaintDialogProps = {
  order: OrderWithServices | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ComplaintDialog({ order, open, onOpenChange }: ComplaintDialogProps) {
  const { toast } = useToast();
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setCategory("");
    setDescription("");
  }, [open, order?.assignedToId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Select an order first.");
      const response = await apiRequest("POST", "/api/complaints", {
        orderId: order.id,
        category,
        description: description.trim(),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/complaints"] });
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${order?.id}/complaints`] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Complaint raised", description: "The complaint has been recorded and the designer was notified." });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      const match = error.message.match(/"message":"([^"]+)"/);
      toast({
        title: "Could not raise complaint",
        description: match?.[1] || "Check the complaint details and try again.",
        variant: "destructive",
      });
    },
  });

  const canSubmit = Boolean(order?.assignedToId && category && description.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise Complaint</DialogTitle>
          <DialogDescription className="text-slate-400">
            Record a complaint for {order?.orderNumber ? `#${order.orderNumber}` : "this order"}. It will be linked to the order permanently.
          </DialogDescription>
        </DialogHeader>

        {!order?.assignedToId ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            Assign a designer to this order before raising a complaint.
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Complaint against</Label>
              <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300">
                {order?.assignee?.name || "Assigned designer"}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="complaint-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="complaint-category" className="bg-slate-950 border-slate-700">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {complaintCategories.map(value => (
                    <SelectItem key={value} value={value}>{complaintCategoryLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="complaint-description">Description</Label>
              <Textarea
                id="complaint-description"
                value={description}
                onChange={event => setDescription(event.target.value)}
                placeholder="Describe what happened and include the relevant facts."
                rows={6}
                maxLength={5000}
                className="bg-slate-950 border-slate-700 resize-none"
              />
              <p className="text-xs text-slate-500">{description.length}/5000</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="bg-red-600 hover:bg-red-500"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Raise Complaint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}