import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/** Writes a CSV string to a temp file and opens the native share sheet. */
export const shareCsv = async (filename: string, csv: string): Promise<void> => {
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: filename });
  }
};
