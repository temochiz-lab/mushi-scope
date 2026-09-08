# mushi-scope

iPhoneで虫の声を学習PNGとして保存し、PCで判別プロファイルへ統合して、リアルタイム判別に利用する静的Webアプリです。音声処理、PNG作成、PNG読込はいずれもブラウザ内で完結します。

## GitHub Pages

- リアルタイム判別: https://temochiz-lab.github.io/mushi-scope/
- iPhone学習アプリ: https://temochiz-lab.github.io/mushi-scope/learn/
- PC学習読み込みアプリ: https://temochiz-lab.github.io/mushi-scope/import/

## 3つの画面

- `/learn/`: iPhoneで虫名を付けて10〜30秒録音し、学習PNGを作成
- `/import/`: PCで複数の学習PNGを検査・再生・統合し、判別JSONを生成
- `/`: iPhoneのマイク入力を、学習済みまたは標準のプロファイルでリアルタイム判別

## 学習データの流れ

1. `/learn/`で虫名と録音時間を指定して録音します。
2. 「画像を共有・保存」から元のPNGを写真またはファイルへ保存します。
3. PCへPNGを移し、`/import/`で複数選択します。
4. 内容と録音を確認し、`insect-profiles-v1.json`をダウンロードします。
5. JSONを`data/profiles/insect-profiles-v1.json`へ配置して公開します。

学習PNGは1024×1024です。上部に虫名・録音日時を表示し、下部へ最大約620KBのデータを6bit/ピクセルで格納します。内部には虫名、日時、32帯域の特徴量、ブラウザが生成した圧縮音声、SHA-256検査値が含まれます。リサイズやJPEG変換をせず、元のPNGをPCへ移してください。

## 現在の実装範囲

- 利用者操作によるマイク許可と解析開始 / 停止
- Web Audio API によるモノラル入力、低域抑制、FFT
- 任意の虫名を含む学習プロファイル、または5種の標準周波数帯 + 「不明」の複数候補表示
- 推定相対音量を 18〜64px の文字サイズへ変換
- 判定確信度を透明度へ変換
- 移動平均、検出保持、フェードアウトによる表示安定化
- 音声データを送信しないブラウザ内処理

現時点ではニューラルネットワークではなく、学習録音から作った周波数パターンとの類似度による簡易推定です。屋外ノイズや複数音源の影響を受けるため、種レベルの正確な同定を保証するものではありません。

## 起動

マイク利用には `localhost` または HTTPS が必要です。任意の静的 HTTP サーバーでこのフォルダを配信してください。

```powershell
python -m http.server 4173
```

ブラウザで `http://localhost:4173` を開きます。

## テスト

```powershell
npm test
```
