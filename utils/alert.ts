import { Alert } from 'react-native';
import { t } from './i18n';

/** Simple OK-only alert. */
export const showAlert = (title: string, message?: string, onOk?: () => void): void => {
  Alert.alert(t(title), message ? t(message) : message, [{ text: t('OK'), onPress: onOk }]);
};

/** Cancel/confirm dialog for destructive actions. */
export const confirmAction = (title: string, message: string, confirmLabel: string, onConfirm: () => void): void => {
  Alert.alert(t(title), t(message), [
    { text: t('Cancel'), style: 'cancel' },
    { text: t(confirmLabel), style: 'destructive', onPress: onConfirm },
  ]);
};
