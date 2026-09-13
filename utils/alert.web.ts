// react-native-web's Alert.alert() is a total no-op (its source is literally
// `static alert() {}`), so this is a real replacement, not a style choice.
// Metro picks this file automatically for web.

export const showAlert = (title: string, message?: string, onOk?: () => void): void => {
  window.alert(message ? `${title}\n\n${message}` : title);
  onOk?.();
};

export const confirmAction = (title: string, message: string, _confirmLabel: string, onConfirm: () => void): void => {
  if (window.confirm(`${title}\n\n${message}`)) {
    onConfirm();
  }
};
