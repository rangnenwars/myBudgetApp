/** Triggers a browser download of a text file. Metro picks this file automatically for web. */
export const shareTextFile = async (filename: string, text: string, mimeType: string): Promise<void> => {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/** Triggers a browser download of a CSV string. */
export const shareCsv = (filename: string, csv: string): Promise<void> => shareTextFile(filename, csv, 'text/csv');
