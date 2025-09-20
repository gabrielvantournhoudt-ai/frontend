#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Backend Production para Calculadora ADRs v2.5
Otimizado para deploy em produção (Vercel/Railway/Render)
"""

import json
import urllib.request
import logging
import os
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler

# Configurar logging para produção
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Cache de dados
data_cache = {
    'vix': None,
    'gold': None,
    'iron': None,
    'winfut': None,
    'adrs': {},
    'macro': {},
    'timestamp': None,
    'status': 'initializing'
}

# Tickers reais e funcionais
TICKERS = {
    'vix': '^VIX',
    'gold': 'GC=F',
    'iron': 'HG=F',
    'winfut': '^BVSP',
    'adrs': ['VALE', 'ITUB', 'PBR', 'PBR-A', 'BBD', 'BBDO', 'ABEV', 'ERJ'],
    'macro': {
        'ewz': 'EWZ',
        'sp500': '^GSPC',
        'oil': 'CL=F',
        'dxy': 'DX-Y.NYB'
    }
}

def fetch_yahoo_data(ticker, is_adr=False):
    """Busca dados reais do Yahoo Finance"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode())
            
        if 'chart' in data and 'result' in data['chart'] and data['chart']['result']:
            result = data['chart']['result'][0]
            meta = result.get('meta', {})
            
            if is_adr:
                regular_price = meta.get('regularMarketPrice')
                previous_close = meta.get('previousClose')
                after_hours_price = meta.get('postMarketPrice')
                
                if regular_price and previous_close:
                    variation = ((regular_price - previous_close) / previous_close) * 100
                    
                    return {
                        'current': round(regular_price, 2),
                        'variation': round(variation, 2),
                        'timestamp': datetime.now().isoformat(),
                        'ticker': ticker,
                        'source': 'closing-price',
                        'has_after_market': bool(after_hours_price),
                        'data_type': 'closing',
                        'message': 'Dados de fechamento (after-market disponível para preenchimento manual)'
                    }
                else:
                    return {
                        'current': None,
                        'variation': None,
                        'timestamp': datetime.now().isoformat(),
                        'ticker': ticker,
                        'source': 'no-data',
                        'has_after_market': False,
                        'data_type': 'closing',
                        'message': 'Sem dados de fechamento disponíveis'
                    }
            else:
                current_price = meta.get('regularMarketPrice')
                previous_close = meta.get('previousClose', current_price)
                
                if current_price and previous_close:
                    variation = ((current_price - previous_close) / previous_close) * 100
                    
                    return {
                        'current': round(current_price, 2),
                        'variation': round(variation, 2),
                        'timestamp': datetime.now().isoformat(),
                        'ticker': ticker,
                        'source': 'regular-market'
                    }
        return None
    except Exception as e:
        logger.error(f"Erro ao buscar {ticker}: {str(e)}")
        return None

def fetch_market_data():
    """Busca dados reais do mercado"""
    logger.info("Buscando dados reais do mercado...")
    
    try:
        # VIX
        vix_data = fetch_yahoo_data(TICKERS['vix'])
        if vix_data:
            data_cache['vix'] = vix_data
        
        # Gold
        gold_data = fetch_yahoo_data(TICKERS['gold'])
        if gold_data:
            data_cache['gold'] = gold_data
        
        # Iron Ore
        iron_data = fetch_yahoo_data(TICKERS['iron'])
        if iron_data:
            data_cache['iron'] = iron_data
        
        # WINFUT
        winfut_data = fetch_yahoo_data(TICKERS['winfut'])
        if winfut_data:
            data_cache['winfut'] = winfut_data
        
        # ADRs
        for ticker in TICKERS['adrs']:
            adr_data = fetch_yahoo_data(ticker, is_adr=True)
            if adr_data:
                data_cache['adrs'][ticker] = adr_data
        
        # Indicadores Macro
        for key, ticker in TICKERS['macro'].items():
            macro_data = fetch_yahoo_data(ticker)
            if macro_data:
                data_cache['macro'][key] = macro_data
        
        data_cache['timestamp'] = datetime.now().isoformat()
        data_cache['status'] = 'success'
        
        logger.info("✅ Dados reais atualizados com sucesso")
        
    except Exception as e:
        logger.error(f"❌ Erro ao buscar dados reais: {str(e)}")
        data_cache['status'] = 'error'
        data_cache['error'] = str(e)

class APIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Manipula requisições GET"""
        # Configurar CORS para produção
        origin = self.headers.get('Origin', '*')
        allowed_origins = [
            'https://calculadora-adrs.vercel.app',  # Seu domínio da Vercel
            'https://calculadora-adrs-production.vercel.app',  # Domínio alternativo
            'http://localhost:3000',  # Desenvolvimento local
            'http://localhost:8080',  # Desenvolvimento local alternativo
            'http://127.0.0.1:3000',  # Desenvolvimento local
            '*'  # Permitir todos em desenvolvimento
        ]
        
        if origin in allowed_origins or '*' in allowed_origins:
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', origin if origin != '*' else '*')
        else:
            self.send_response(403)
            self.send_header('Access-Control-Allow-Origin', 'null')
        
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.end_headers()
        
        # Roteamento
        if self.path == '/api/market-data':
            response_data = {
                "status": "success",
                "timestamp": data_cache.get('timestamp', datetime.now().isoformat()),
                "data": {
                    "vix": data_cache.get('vix', {}),
                    "gold": data_cache.get('gold', {}),
                    "iron": data_cache.get('iron', {}),
                    "winfut": data_cache.get('winfut', {}),
                    "adrs": data_cache.get('adrs', {}),
                    "macro": data_cache.get('macro', {})
                }
            }
            response = json.dumps(response_data, ensure_ascii=False)
        elif self.path == '/api/health':
            response = json.dumps({
                "status": "ok",
                "timestamp": datetime.now().isoformat(),
                "data_status": data_cache.get('status', 'unknown'),
                "last_update": data_cache.get('timestamp', 'never'),
                "mode": "production",
                "version": "2.5"
            }, ensure_ascii=False)
        elif self.path == '/api/update':
            fetch_market_data()
            response = json.dumps({
                "status": "updated",
                "timestamp": datetime.now().isoformat()
            }, ensure_ascii=False)
        elif self.path == '/api/vix':
            response = json.dumps(data_cache.get('vix', {}), ensure_ascii=False)
        elif self.path == '/api/gold':
            response = json.dumps(data_cache.get('gold', {}), ensure_ascii=False)
        elif self.path == '/api/iron':
            response = json.dumps(data_cache.get('iron', {}), ensure_ascii=False)
        elif self.path == '/api/adrs':
            response = json.dumps(data_cache.get('adrs', {}), ensure_ascii=False)
        elif self.path == '/api/macro':
            response = json.dumps(data_cache.get('macro', {}), ensure_ascii=False)
        elif self.path == '/':
            # Endpoint raiz para verificação
            response = json.dumps({
                "message": "Calculadora ADRs Backend v2.5",
                "status": "online",
                "endpoints": [
                    "/api/market-data",
                    "/api/health",
                    "/api/update",
                    "/api/vix",
                    "/api/gold",
                    "/api/iron",
                    "/api/adrs",
                    "/api/macro"
                ]
            }, ensure_ascii=False)
        else:
            response = json.dumps({"error": "Endpoint not found"}, ensure_ascii=False)
        
        self.wfile.write(response.encode('utf-8'))
    
    def do_OPTIONS(self):
        """Manipula requisições OPTIONS para CORS"""
        origin = self.headers.get('Origin', '*')
        allowed_origins = [
            'https://calculadora-adrs.vercel.app',
            'https://calculadora-adrs-production.vercel.app',
            'http://localhost:3000',
            'http://localhost:8080',
            'http://127.0.0.1:3000',
            '*'
        ]
        
        if origin in allowed_origins or '*' in allowed_origins:
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', origin if origin != '*' else '*')
        else:
            self.send_response(403)
        
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

def run_server():
    """Executa o servidor HTTP"""
    # Obter porta do ambiente (para produção)
    port = int(os.environ.get('PORT', 5000))
    server_address = ('', port)
    httpd = HTTPServer(server_address, APIHandler)
    
    logger.info(f"🚀 Servidor PRODUÇÃO iniciado na porta {port}")
    logger.info("📊 Modo: Dados reais do Yahoo Finance")
    logger.info("🌐 Ambiente: Produção")
    logger.info("🔧 Versão: 2.5")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Servidor parado pelo usuário")
        httpd.shutdown()

if __name__ == '__main__':
    logger.info("Iniciando Calculadora ADRs Backend PRODUÇÃO v2.5")
    
    # Buscar dados iniciais
    fetch_market_data()
    
    # Executar servidor
    run_server()