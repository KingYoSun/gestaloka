export function playerSettings(base: string, character: string) {
  return base.trim()
    ? `参加者の基本設定\n${base}\n\n人物の個別設定\n${character}`
    : character;
}
