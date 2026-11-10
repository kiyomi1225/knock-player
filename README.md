# knock-player

家庭用の筆算ドリル「筆算ノック」の再生チケット専用プレーヤー。
`?v=<YouTube動画ID>&t=<タイトル>` で開くと、YouTube 公式の埋め込みプレーヤーで1本だけ流し、終わったら「おしまい」を出す。

## battle/（筆算バトル）

`battle/` は友だちと対戦するページ（じゃんけん × 筆算、3ラウンド×3問）。https://kiyomi1225.github.io/knock-player/battle/
- リアルタイム対戦: 4桁のへや番号で2人をつなぐ。中継は無料の公開 MQTT サーバー（HiveMQ・EMQX）を2つ同時に使う。送るのは名前・進み具合・タイムだけ
- 挑戦状: 記録を URL の # に入れて送る（サーバー不要）
- 元のファイルは非公開リポジトリ側（hissan/battle/）。`sh hissan/tools/sync_battle.sh` でここにコピーする。公式画像は入れない
