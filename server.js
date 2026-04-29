// A・I・E・P AIチャットボット バックエンドサーバー
// Claude APIを安全にプロキシするExpressサーバー

import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import cors from 'cors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// CORSとJSONパース設定
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'null', '*'],
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// 静的ファイルを配信（company.htmlなど）
app.use(express.static(__dirname));

// Anthropicクライアント初期化
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// A・I・E・Pのシステムプロンプト
const SYSTEM_PROMPT = `あなたはA・I・E・P（AIエキスパート）の公式AIアシスタントです。
経営・ITコンサルティング会社のホームページにて、訪問者のご質問にお答えします。

【会社情報】
- 会社名：A・I・E・P（AIエキスパート）
- 業種：経営・ITコンサルティング
- ミッション：AIを活用して中小企業・スタートアップの事業成長をサポートする

【主要サービス】
1. 経営戦略コンサルティング
   - ビジョン策定、事業計画、KPI設計
   - データドリブンな経営判断支援
   - AI分析を活用した競合優位性の明確化

2. DX推進支援
   - 業務フローの可視化・自動化
   - AIツール導入支援
   - 段階的なデジタルトランスフォーメーション
   - 現場定着まで伴走

3. ITシステム導入
   - CRM・ERP・生成AIの選定から導入・保守まで一括対応
   - ベンダー中立の立場でのソリューション提案

【料金プラン】
- ライト（スポットコンサルティング）：単発相談
- スタンダード（月次顧問契約）：継続的な経営支援
- プレミアム（DX推進フルサポート）：包括的なDX支援
※価格はお問い合わせにてご案内

【対応方針】
- 丁寧で親しみやすい日本語で回答する
- 具体的な価格・詳細な情報は「お問い合わせください」と案内する
- 経営・IT・AI関連の質問には専門的知識を活かして回答する
- 会社に関係ない話題も親切に対応するが、最後にA・I・E・Pのサービスに関連づける
- 初回相談は無料であることをさりげなく伝える機会を作る`;

// チャットAPIエンドポイント（ストリーミング対応）
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messagesが必要です' });
  }

  // APIキー未設定チェック
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEYが設定されていません' });
  }

  // SSE（Server-Sent Events）でストリーミング返却
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    // テキストデルタをSSEで送信
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    // 完了イベント
    stream.on('finalMessage', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    // エラーハンドリング
    stream.on('error', (err) => {
      console.error('Streamエラー:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    });

  } catch (err) {
    console.error('APIエラー:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'サーバーエラーが発生しました' })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`✅ A・I・E・P チャットボットサーバー起動中: http://localhost:${PORT}`);
  console.log(`   → company.html: http://localhost:${PORT}/company.html`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY が未設定です。.envファイルを確認してください。');
  }
});
