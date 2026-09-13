import { Alert } from 'react-native';

/** Simple OK-only alert. */
export const showAlert = (title: string, message?: string, onOk?: () => void): void => {
  Alert.alert(title, message, [{ text: 'OK', onPress: onOk }]);
};

/** Cancel/confirm dialog for destructive actions. */
export const confirmAction = (title: string, message: string, confirmLabel: string, onConfirm: () => void): void => {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
};
