import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useChats() {
  return useQuery({
    queryKey: [api.chats.list.path],
    queryFn: async () => {
      const res = await fetch(api.chats.list.path);
      if (!res.ok) throw new Error("Failed to fetch chats");
      return api.chats.list.responses[200].parse(await res.json());
    },
  });
}

export function useChat(id: number) {
  return useQuery({
    queryKey: [api.chats.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.chats.get.path, { id });
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch chat details");
      return api.chats.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
    refetchInterval: 3000, // Simple polling for new messages
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ chatId, content }: { chatId: number; content: string }) => {
      const url = buildUrl(api.chats.sendMessage.path, { id: chatId });
      const res = await fetch(url, {
        method: api.chats.sendMessage.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return api.chats.sendMessage.responses[201].parse(await res.json());
    },
    onSuccess: (_, { chatId }) => {
      queryClient.invalidateQueries({ queryKey: [api.chats.get.path, chatId] });
      queryClient.invalidateQueries({ queryKey: [api.chats.list.path] });
    },
  });
}

export function useUpdateChatStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const url = buildUrl(api.chats.update.path, { id });
      const res = await fetch(url, {
        method: api.chats.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return api.chats.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.chats.list.path] });
      toast({ title: "Status Updated" });
    },
  });
}
