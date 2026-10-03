import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/** Writes text to a temp file and opens the native share sheet (save to Files, email, etc.). */
export const shareTextFile = async (filename: string, text: string, mimeType: string): Promise<void> => {
  const uri = FileSystem.cacheDirectory + filename;
  await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: filename });
  }
};

/** Writes a CSV string to a temp file and opens the native share sheet. */
export const shareCsv = (filename: string, csv: string): Promise<void> => shareTextFile(filename, csv, 'text/csv');
