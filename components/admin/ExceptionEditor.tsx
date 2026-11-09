import React, { useState } from 'react';
import { View, Text, StyleSheet, Switch } from 'react-native';
import { Button, ErrorText, Field } from '../ScreenKit';
import { DateInput } from '../DateInput';
import { COLORS, RADIUS, SPACING } from '../../constants/theme';
import { confirmAction } from '../../utils/alert';
import { apiErrorMessage } from '../../utils/api';
import { setException } from '../../utils/plan';
import { todayLocalIso } from '../../utils/dates';

interface Props {
  userId: number;
  /** The exception in force now, or null. */
  current: { reason: string; ends_at: string | null } | null;
  onChanged: () => void;
  /** Only an admin can set one; others see it read-only. */
  canEdit: boolean;
}

/** "YYYY-MM-DD" of an ISO timestamp, in India (an exception lasts through the end of that day there). */
const istDate = (iso: string): string => new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * One user's exception: full access on purpose, with a reason and an optional last day.
 * With no last day it never ends by itself, so the exceptions list flags it.
 */
export const ExceptionEditor: React.FC<Props> = ({ userId, current, onChanged, canEdit }) => {
  const [on, setOn] = useState(!!current);
  const [reason, setReason] = useState(current?.reason ?? '');
  const [until, setUntil] = useState(current?.ends_at ? istDate(current.ends_at) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (reason.trim().length < 3) return setError('Give a reason, so it can be reviewed later.');
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return setError('Enter the last day as YYYY-MM-DD, or leave it empty for no end date.');
    setBusy(true);
    try {
      await setException(userId, { on: true, reason: reason.trim(), until: until || null });
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the exception.'));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = () =>
    confirmAction('Turn off the exception', 'Their access goes back to what their plan gives them. Nothing they saved is touched.', 'Turn off', async () => {
      setBusy(true);
      try {
        await setException(userId, { on: false });
        setOn(false);
        setReason('');
        setUntil('');
        onChanged();
      } catch (err) {
        setError(apiErrorMessage(err, 'Could not turn it off.'));
      } finally {
        setBusy(false);
      }
    });

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Exception: full access</Text>
          <Text style={styles.sub}>Instant, for this user only</Text>
        </View>
        <Switch
          value={on}
          disabled={!canEdit || busy}
          onValueChange={(v) => {
            if (v) setOn(true);
            else if (current) turnOff();
            else setOn(false);
          }}
          trackColor={{ false: COLORS.cardBorder, true: COLORS.accent }}
        />
      </View>
      {on && (
        <>
          <Field label="Reason (required)" value={reason} onChangeText={setReason} editable={canEdit} placeholder="e.g. Scholarship student" />
          <Text style={styles.label}>Until (last day)</Text>
          <DateInput value={until} onChange={setUntil} min={todayLocalIso()} inputStyle={styles.input} accessibilityLabel="Exception last day" />
          <Text style={styles.sub}>{until ? 'Ends at the end of that day.' : 'No end date. It stays until you turn it off, and it is flagged in the exceptions list.'}</Text>
          <ErrorText message={error} />
          {canEdit && <Button label={busy ? 'Saving…' : current ? 'Save changes' : 'Turn on'} onPress={save} disabled={busy} />}
        </>
      )}
      {!on && <ErrorText message={error} />}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: `${COLORS.yellow}66`, borderRadius: RADIUS.md, padding: SPACING.md, gap: SPACING.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  title: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  sub: { color: COLORS.textDim, fontSize: 12 },
  label: { color: COLORS.textMuted, fontSize: 13 },
  input: { backgroundColor: COLORS.input, borderColor: COLORS.cardBorder, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: 12, color: COLORS.text, fontSize: 15 },
});
