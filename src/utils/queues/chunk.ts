export const chunk = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    if (!item) continue;
    const chunkIndex = Math.floor(i / size);
    if (!result[chunkIndex]) {
      result[chunkIndex] = [];
    }
    result[chunkIndex].push(item);
  }
  return result;
};