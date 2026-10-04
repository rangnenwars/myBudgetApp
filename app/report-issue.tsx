import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Image, Platform, ActivityIndicator } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_SCREENS,
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_MIME_TYPES,
  IssueCategory,
  IssueSeverity,
  IssueScreen,
  ScreenshotMimeType,
} from '../constants/issues';
import { submitIssueReport, getMyIssueReports, base64ByteLength, IssueReportSummary } from '../utils/issues';
import { showAlert } from '../utils/alert';
import { apiErrorMessage } from '../utils/api';

interface Screenshot {
  uri: string;
  data: string;
  mimeType: ScreenshotMimeType;
  bytes: number;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new: { label: 'Received', color: COLORS.blue },
  triaged: { label: 'Being looked at', color: COLORS.yellow },
  resolved: { label: 'Fixed', color: COLORS.accent },
  wont_fix: { label: 'Closed', color: COLORS.textMuted },
};

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const mimeFromAsset = (asset: ImagePicker.ImagePickerAsset): string | undefined => {
  if (asset.mimeType) return asset.mimeType;
  const dataUrl = /^data:([^;,]+)/.exec(asset.uri)?.[1];
  if (dataUrl) return dataUrl;
  const ext = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : undefined;
};

const deviceInfo = (): string => {
  // Platform.Version is a meaningless "0.0.0" on web; the user agent says more there.
  const parts = [Platform.OS, Platform.OS === 'web' ? '' : String(Platform.Version ?? '')];
  if (Constants.deviceName) parts.push(Constants.deviceName);
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') parts.push(navigator.userAgent);
  return parts.filter(Boolean).join(' · ').slice(0, 200);
};

function Chips<K extends string>({ options, value, onChange }: { options: readonly { key: K; label: string }[]; value: K | null; onChange: (k: K) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable key={o.key} onPress={() => onChange(o.key)} style={[styles.chip, value === o.key && styles.chipActive]}>
          <Text style={[styles.chipText, value === o.key && styles.chipTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function ReportIssueScreen() {
  const params = useLocalSearchParams<{ screen?: string }>();
  const initialScreen = ISSUE_SCREENS.some((s) => s.key === params.screen) ? (params.screen as IssueScreen) : null;

  const [category, setCategory] = useState<IssueCategory | null>(null);
  const [severity, setSeverity] = useState<IssueSeverity>('medium');
  const [screen, setScreen] = useState<IssueScreen | null>(initialScreen);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [mine, setMine] = useState<IssueReportSummary[]>([]);

  const loadMine = useCallback(() => {
    getMyIssueReports().then(setMine).catch(() => setMine([]));
  }, []);
  useFocusEffect(loadMine);

  const pickScreenshot = async () => {
    setError(null);
    setPicking(true);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError('Photo access is needed to attach a screenshot. You can allow it in Settings.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.8, allowsEditing: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      const mimeType = mimeFromAsset(asset);
      if (!mimeType || !(SCREENSHOT_MIME_TYPES as readonly string[]).includes(mimeType)) {
        setError('Screenshots must be PNG, JPEG, or WebP images.');
        return;
      }
      // Web returns the image as a data: URL in uri; native returns base64 separately.
      const data = asset.base64 ?? (asset.uri.startsWith('data:') ? asset.uri : null);
      if (!data) {
        setError('Could not read that image. Try another one.');
        return;
      }
      const bytes = base64ByteLength(data);
      if (bytes > MAX_SCREENSHOT_BYTES) {
        setError(`That image is ${formatBytes(bytes)} — screenshots can be at most 2 MB. Crop it or pick a smaller one.`);
        return;
      }
      setScreenshot({ uri: asset.uri, data, mimeType: mimeType as ScreenshotMimeType, bytes });
    } catch {
      setError('Could not open your photos.');
    } finally {
      setPicking(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (!category) return setError('Pick what kind of problem this is.');
    if (!screen) return setError('Pick where in the app it happened.');
    if (title.trim().length < 3) return setError('Give the issue a short title.');
    if (description.trim().length < 10) return setError('Describe what happened (at least 10 characters).');

    setSaving(true);
    try {
      await submitIssueReport({
        category,
        severity,
        screen,
        title: title.trim(),
        description: description.trim(),
        steps_to_reproduce: steps.trim() || null,
        expected_behavior: expected.trim() || null,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? null,
        device_info: deviceInfo(),
        screenshot: screenshot ? { data: screenshot.data, mime_type: screenshot.mimeType } : null,
      });
      showAlert('Thanks for reporting', "We've got your report and will look into it.", () => router.back());
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not send your report. Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Close">
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Report an issue</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>What kind of problem? *</Text>
        <Chips options={ISSUE_CATEGORIES} value={category} onChange={setCategory} />

        <Text style={[styles.label, styles.gap]}>Where did it happen? *</Text>
        <Chips options={ISSUE_SCREENS} value={screen} onChange={setScreen} />

        <Text style={[styles.label, styles.gap]}>How much does it get in your way?</Text>
        <View style={styles.segment}>
          {ISSUE_SEVERITIES.map((s) => (
            <Pressable key={s.key} style={[styles.segmentBtn, severity === s.key && styles.segmentBtnActive]} onPress={() => setSeverity(s.key)}>
              <Text style={[styles.segmentText, severity === s.key && styles.segmentTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, styles.gap]}>Title *</Text>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Loan EMI total looks wrong" placeholderTextColor={COLORS.textDim} maxLength={120} />

        <Text style={[styles.label, styles.gap]}>What happened? *</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Describe what you saw. Include any error message."
          placeholderTextColor={COLORS.textDim}
          multiline
          maxLength={5000}
        />

        <Text style={[styles.label, styles.gap]}>Steps to reproduce</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={steps}
          onChangeText={setSteps}
          placeholder={'1. Open Loans\n2. Tap the home loan\n3. …'}
          placeholderTextColor={COLORS.textDim}
          multiline
          maxLength={5000}
        />

        <Text style={[styles.label, styles.gap]}>What did you expect instead?</Text>
        <TextInput style={styles.input} value={expected} onChangeText={setExpected} placeholder="Optional" placeholderTextColor={COLORS.textDim} maxLength={2000} />

        <Text style={[styles.label, styles.gap]}>Screenshot (optional, max 2 MB)</Text>
        {screenshot ? (
          <View style={styles.shotRow}>
            <Image source={{ uri: screenshot.uri }} style={styles.shotThumb} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.shotText}>{screenshot.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(screenshot.bytes)}</Text>
              <Pressable onPress={() => setScreenshot(null)} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.attachBtn} onPress={pickScreenshot} disabled={picking}>
            {picking ? <ActivityIndicator color={COLORS.accent} /> : <Ionicons name="image-outline" size={18} color={COLORS.accent} />}
            <Text style={styles.attachText}>Attach a screenshot</Text>
          </Pressable>
        )}

        <Text style={styles.hint}>Your app version and device type are included automatically to help us reproduce the problem.</Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={onSubmit} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? 'Sending…' : 'Send report'}</Text>
        </Pressable>

        {mine.length > 0 && (
          <>
            <Text style={[styles.label, { marginTop: SPACING.xl }]}>Your earlier reports</Text>
            {mine.map((r) => {
              const st = STATUS_LABEL[r.status] ?? STATUS_LABEL.new;
              return (
                <View key={r.id} style={styles.mineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mineTitle} numberOfLines={1}>{r.title}</Text>
                    <Text style={styles.mineMeta}>#{r.id} · {new Date(r.created_at).toLocaleDateString('en-IN')}</Text>
                  </View>
                  <View style={[styles.statusChip, { borderColor: st.color }]}>
                    <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.cardBorder,
  },
  backBtn: { width: 30 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  container: { padding: SPACING.lg, gap: SPACING.xs, paddingBottom: SPACING.xl * 2 },
  label: { color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.xs },
  gap: { marginTop: SPACING.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  chip: { borderWidth: 1, borderColor: COLORS.cardBorder, backgroundColor: COLORS.input, borderRadius: RADIUS.full, paddingHorizontal: SPACING.md, paddingVertical: 8 },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textMuted, fontSize: 13 },
  chipTextActive: { color: COLORS.onAccent, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: COLORS.input, borderRadius: RADIUS.md, padding: 4 },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: RADIUS.sm },
  segmentBtnActive: { backgroundColor: COLORS.accent },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  segmentTextActive: { color: COLORS.onAccent },
  input: {
    backgroundColor: COLORS.input,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    color: COLORS.text,
    fontSize: 14,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderStyle: 'dashed',
    borderRadius: RADIUS.md,
    paddingVertical: 14,
  },
  attachText: { color: COLORS.accent, fontWeight: '600', fontSize: 13 },
  shotRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, backgroundColor: COLORS.card, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, padding: SPACING.sm },
  shotThumb: { width: 72, height: 72, borderRadius: RADIUS.sm, backgroundColor: COLORS.input },
  shotText: { color: COLORS.text, fontSize: 13 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: SPACING.xs, alignSelf: 'flex-start', paddingVertical: 4 },
  removeText: { color: COLORS.red, fontSize: 13 },
  hint: { color: COLORS.textDim, fontSize: 11.5, marginTop: SPACING.md, lineHeight: 16 },
  error: { color: COLORS.red, fontSize: 13, marginTop: SPACING.sm },
  saveBtn: { backgroundColor: COLORS.accent, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center', marginTop: SPACING.lg },
  saveBtnText: { color: COLORS.onAccent, fontWeight: '700', fontSize: 16 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  mineTitle: { color: COLORS.text, fontSize: 13 },
  mineMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  statusChip: { borderWidth: 1, borderRadius: RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
});
