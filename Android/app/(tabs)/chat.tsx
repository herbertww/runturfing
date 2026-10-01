import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Image, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi, seasonsApi } from '../../src/services/apiClient';
import { ChatMessage, TerritoryEventType } from '../../src/types';
import { useAuthStore } from '../../src/stores/authStore';
import { useTerritoryStore } from '../../src/stores/territoryStore';
import { demoChatMessages } from '../../src/utils/demoData';
import { DEMO_ME } from '../../src/utils/demoTerritory';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../src/utils/theme';

const EVENT_CONFIG: Record<TerritoryEventType, { icon: string; color: string; label: string }> = {
  defended_loop: { icon: 'shield-checkmark', color: COLORS.success, label: 'Loop Defended' },
  lost_corridor: { icon: 'warning', color: COLORS.error, label: 'Corridor Lost' },
  reclaimed_zone: { icon: 'refresh-circle', color: COLORS.primary, label: 'Zone Reclaimed' },
  group_milestone: { icon: 'trophy', color: '#FFD700', label: 'Group Milestone' },
  new_claim: { icon: 'flag', color: COLORS.primary, label: 'New Claim' },
  season_start: { icon: 'play-circle', color: COLORS.success, label: 'Season Started' },
  season_end: { icon: 'stop-circle', color: COLORS.warning, label: 'Season Ended' },
};

const QUICK_REACTIONS = ['🔥', '💪', '🏃', '⚡', '👊', '🎯'];

function TerritoryEventCard({ message }: { message: ChatMessage }) {
  const cfg = EVENT_CONFIG[message.eventType!] ?? EVENT_CONFIG.new_claim;
  return (
    <View style={[styles.eventCard, { borderLeftColor: cfg.color }]}>
      <View style={[styles.eventIcon, { backgroundColor: cfg.color + '22' }]}>
        <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.eventLabel, { color: cfg.color }]}>{cfg.label}</Text>
        <Text style={styles.eventText}>{message.text}</Text>
      </View>
    </View>
  );
}

function ReactionBar({
  message,
  onReact,
}: {
  message: ChatMessage;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  return (
    <View style={styles.reactionContainer}>
      {message.reactions.map((r) => (
        <TouchableOpacity
          key={r.emoji}
          style={[styles.reactionChip, r.userReacted && styles.reactionChipActive]}
          onPress={() => onReact(message.id, r.emoji)}
        >
          <Text style={styles.reactionEmoji}>{r.emoji}</Text>
          <Text style={[styles.reactionCount, r.userReacted && { color: COLORS.primary }]}>
            {r.count}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={styles.addReactionButton}
        onPress={() => setShowPicker(!showPicker)}
      >
        <Ionicons name="add" size={14} color={COLORS.textMuted} />
      </TouchableOpacity>
      {showPicker && (
        <View style={styles.reactionPicker}>
          {QUICK_REACTIONS.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={styles.reactionPickerItem}
              onPress={() => {
                onReact(message.id, emoji);
                setShowPicker(false);
              }}
            >
              <Text style={{ fontSize: 22 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function MessageBubble({
  message,
  isOwn,
  onReact,
}: {
  message: ChatMessage;
  isOwn: boolean;
  onReact: (messageId: string, emoji: string) => void;
}) {
  if (message.type === 'territory_event') {
    return (
      <View style={styles.eventWrapper}>
        <TerritoryEventCard message={message} />
        <ReactionBar message={message} onReact={onReact} />
      </View>
    );
  }

  if (message.type === 'system') {
    return (
      <View style={styles.systemMessage}>
        <Text style={styles.systemText}>{message.text}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleWrapper, isOwn && styles.bubbleWrapperOwn]}>
      {!isOwn && (
        <View style={styles.senderAvatar}>
          <Text style={styles.senderAvatarText}>
            {message.senderName.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={{ maxWidth: '75%' }}>
        {!isOwn && (
          <Text style={styles.senderName}>{message.senderName}</Text>
        )}
        <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>
            {message.text}
          </Text>
          <Text style={[styles.bubbleTime, isOwn && { color: 'rgba(255,255,255,0.5)' }]}>
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        {message.reactions.length > 0 && (
          <ReactionBar message={message} onReact={onReact} />
        )}
      </View>
    </View>
  );
}

const DEMO_THREAD_ID = 'demo-thread';

export default function ChatScreen() {
  const { user } = useAuthStore();
  const { demoMode } = useTerritoryStore();
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const queryClient = useQueryClient();

  // Demo mode never touches the network: messages live in local state, seeded
  // once from a fixed script, and send/react mutate that state directly.
  const [demoMessages, setDemoMessages] = useState<ChatMessage[] | null>(null);
  useEffect(() => {
    if (demoMode && !demoMessages) setDemoMessages(demoChatMessages());
  }, [demoMode, demoMessages]);

  // The real thread lives on the user's season group, not a fixed id — pull
  // the active season, then that season's group, to find its chat_thread_id.
  const { data: currentSeason } = useQuery({
    queryKey: ['season-current'],
    queryFn: () => seasonsApi.getCurrent().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });

  const { data: myGroup, isLoading: isLoadingGroup } = useQuery({
    queryKey: ['season-group', currentSeason?.id],
    queryFn: () => seasonsApi.getMyGroup(currentSeason!.id).then((r) => r.data),
    enabled: !demoMode && !!currentSeason?.id,
    staleTime: 30_000,
    retry: false, // a 404 here just means "not matched into a group yet"
  });

  const threadId = demoMode ? DEMO_THREAD_ID : myGroup?.chatThreadId;

  const { data, isLoading } = useQuery({
    queryKey: ['chat', threadId],
    queryFn: () => chatApi.getMessages(threadId!, user!.id).then((r) => r.data),
    staleTime: 10_000,
    refetchInterval: 15_000,
    enabled: !demoMode && !!threadId && !!user?.id,
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => chatApi.sendMessage(threadId!, text).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', threadId] });
      setInputText('');
    },
  });

  const reactMutation = useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      chatApi.addReaction(messageId, emoji),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', threadId] });
    },
  });

  const handleReact = useCallback(
    (messageId: string, emoji: string) => {
      if (demoMode) {
        setDemoMessages((prev) =>
          (prev ?? []).map((m) => {
            if (m.id !== messageId) return m;
            const existing = m.reactions.find((r) => r.emoji === emoji);
            const reactions = existing
              ? m.reactions.map((r) =>
                  r.emoji === emoji
                    ? { ...r, count: r.userReacted ? r.count - 1 : r.count + 1, userReacted: !r.userReacted }
                    : r
                )
              : [...m.reactions, { emoji, count: 1, userReacted: true }];
            return { ...m, reactions };
          })
        );
        return;
      }
      reactMutation.mutate({ messageId, emoji });
    },
    [demoMode, reactMutation]
  );

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;
    if (demoMode) {
      const msg: ChatMessage = {
        id: `demo-sent-${Date.now()}`,
        threadId: DEMO_THREAD_ID,
        senderId: user?.id ?? DEMO_ME.userId,
        senderName: user?.displayName ?? DEMO_ME.name,
        type: 'text',
        text,
        reactions: [],
        createdAt: new Date().toISOString(),
      };
      setDemoMessages((prev) => [...(prev ?? []), msg]);
      setInputText('');
      return;
    }
    sendMutation.mutate(text);
  };

  const messages = demoMode ? demoMessages ?? [] : data?.messages ?? [];
  const noGroupYet = !demoMode && !isLoadingGroup && !!currentSeason && !myGroup;
  const showLoader = demoMode ? false : isLoadingGroup || (!!threadId && isLoading);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Group Chat</Text>
          <Text style={styles.subtitle}>Season Group · 6 members</Text>
        </View>
        <TouchableOpacity style={styles.infoButton}>
          <Ionicons name="information-circle-outline" size={24} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {showLoader ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : noGroupYet ? (
          <View style={styles.emptyChat}>
            <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyChatText}>No group yet</Text>
            <Text style={styles.emptyChatSubtext}>
              You'll get a chat once you're matched into a season group.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                isOwn={item.senderId === user?.id}
                onReact={handleReact}
              />
            )}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubbles-outline" size={48} color={COLORS.textMuted} />
                <Text style={styles.emptyChatText}>No messages yet</Text>
                <Text style={styles.emptyChatSubtext}>
                  Territory events will appear here automatically.
                </Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder="Message your group..."
            placeholderTextColor={COLORS.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { fontSize: 13, color: COLORS.textMuted },
  infoButton: { padding: SPACING.xs },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.lg },
  eventWrapper: { marginVertical: SPACING.xs },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderLeftWidth: 3,
    gap: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  eventIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  eventText: { fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
  systemMessage: { alignItems: 'center', marginVertical: SPACING.sm },
  systemText: { fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic' },
  bubbleWrapper: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING.sm, marginVertical: 2 },
  bubbleWrapperOwn: { flexDirection: 'row-reverse' },
  senderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  senderAvatarText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  senderName: { fontSize: 11, color: COLORS.textMuted, marginBottom: 3, marginLeft: 4 },
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: 2,
  },
  bubbleOwn: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: COLORS.bgCard, borderBottomLeftRadius: 4, borderWidth: 2, borderColor: COLORS.border },
  bubbleText: { fontSize: 15, color: COLORS.textPrimary, lineHeight: 20 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: COLORS.textMuted, alignSelf: 'flex-end' },
  reactionContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, marginLeft: 4 },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: 3,
  },
  reactionChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '18' },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 12, color: COLORS.textMuted, fontWeight: '700' },
  addReactionButton: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPicker: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: SPACING.xs,
    ...SHADOWS.modal,
    zIndex: 100,
  },
  reactionPickerItem: { padding: 4 },
  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: SPACING.md },
  emptyChatText: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  emptyChatSubtext: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.bgCard,
    gap: SPACING.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.bgInput,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: 15,
    color: COLORS.textPrimary,
    maxHeight: 120,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: COLORS.bgElevated },
});
