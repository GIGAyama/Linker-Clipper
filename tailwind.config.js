/** Tailwind の設定。使うクラスだけを先に作るため、原本を content に並べる。
 *  cdn.tailwindcss.com（ブラウザ内で CSS を生成する版）は使わない。
 *  以前は index.html の中に tailwind.config = {…} として書いてあった。 */
module.exports = {
  content: ["./src/**/*.jsx", "./index.html"],
  theme: {
    extend: {
      colors: { app: { 50: '#f0fdf4', 500: '#22c55e', 600: '#16a34a', 700: '#15803d' } },
      fontFamily: { sans: ['"Nunito"', '"Noto Sans JP"', 'sans-serif'] }
    }
  }
};
