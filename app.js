// Dados dos ADRs baseados no JSON fornecido - v2.3

// ============================================================================
// UTILITÁRIOS DE PERFORMANCE - v2.4
// ============================================================================

// Debounce para inputs - evita cálculos excessivos durante digitação
let debounceTimer;
function debounceUpdate(delay = 300) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        updateAllCalculations();
    }, delay);
}

// Cache para evitar recálculos desnecessários
const calculationCache = new Map();
const CACHE_DURATION = 5000; // 5 segundos

// Cache de elementos DOM para melhor performance
const domCache = new Map();

function getCachedCalculation(key, calculationFn) {
    const cached = calculationCache.get(key);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
        return cached.data;
    }
    
    const result = calculationFn();
    calculationCache.set(key, {
        data: result,
        timestamp: now
    });
    
    return result;
}

// Gerar chave de cache baseada nos dados atuais
function generateCacheKey() {
    const adrData = [];
    
    // Coletar dados dos ADRs principais
    adrsData.principais.forEach(adr => {
        const closingInput = getCachedElement(`closing-${adr.ticker}`);
        const afterInput = getCachedElement(`after-${adr.ticker}`);
        const preInput = getCachedElement(`pre-${adr.ticker}`);
        const checkbox = getCachedElement(`checkbox-${adr.ticker}`);
        
        adrData.push({
            ticker: adr.ticker,
            closing: closingInput ? closingInput.value : '',
            after: afterInput ? afterInput.value : '',
            pre: preInput ? preInput.value : '',
            enabled: checkbox ? checkbox.checked : false
        });
    });
    
    // Coletar dados dos ADRs secundários se habilitados
    if (appState.incluirSecundarios) {
        adrsData.secundarios.forEach(adr => {
            const closingInput = getCachedElement(`closing-${adr.ticker}`);
            const afterInput = getCachedElement(`after-${adr.ticker}`);
            const preInput = getCachedElement(`pre-${adr.ticker}`);
            const checkbox = getCachedElement(`checkbox-${adr.ticker}`);
            
            adrData.push({
                ticker: adr.ticker,
                closing: closingInput ? closingInput.value : '',
                after: afterInput ? afterInput.value : '',
                pre: preInput ? preInput.value : '',
                enabled: checkbox ? checkbox.checked : false
            });
        });
    }
    
    // Incluir dados VIX e configurações
    const configData = {
        vixVariation: appState.vixData.variation,
        vixAbsolute: appState.vixData.absolute,
        effectiveSensitivity: appState.effectiveSensitivity,
        pesoMacro: appState.pesoMacro,
        pesoVix: appState.pesoVix,
        incluirSecundarios: appState.incluirSecundarios
    };
    
    return JSON.stringify({ adrData, configData });
}

// Cache de elementos DOM para melhor performance
function getCachedElement(id) {
    if (domCache.has(id)) {
        return domCache.get(id);
    }
    
    const element = document.getElementById(id);
    if (element) {
        domCache.set(id, element);
    }
    
    return element;
}

// Limpar cache quando necessário
function clearCaches() {
    calculationCache.clear();
    domCache.clear();
}

// ============================================================================
// UTILITÁRIOS DE VALIDAÇÃO - v2.3
// ============================================================================

/**
 * Calcula análise de spread baseada em preços reais (CORRIGIDO)
 * @param {string} ticker - Ticker do ADR
 * @param {number} closingPrice - Preço de fechamento
 * @param {number} afterPercentage - Porcentagem do after-market
 * @param {number} prePercentage - Porcentagem do pré-market
 * @returns {Object} Análise completa de spread
 */
function calculateRealSpreadAnalysis(ticker, closingPrice, afterPercentage, prePercentage) {
    if (!closingPrice || closingPrice <= 0) {
        // console.warn(`Preço de fechamento inválido para ${ticker}:`, closingPrice);
        return null;
    }
    
    // Calcular preços reais na sequência temporal correta
    const afterPrice = closingPrice * (1 + (afterPercentage || 0) / 100);
    const prePrice = prePercentage !== null && prePercentage !== undefined ? 
        afterPrice * (1 + prePercentage / 100) : // ✅ CORRETO: Pré baseado no After
        afterPrice; // Se não há pré-market, usar o after
    
    // Calcular spreads reais
    const afterSpread = ((afterPrice - closingPrice) / closingPrice) * 100;
    const preSpread = prePercentage !== null && prePercentage !== undefined ? 
        ((prePrice - closingPrice) / closingPrice) * 100 : // Spread total do fechamento ao pré
        afterSpread; // Se não há pré, usar o after
    
    // Spread específico After → Pré
    const afterToPreSpread = prePercentage !== null && prePercentage !== undefined ? 
        ((prePrice - afterPrice) / afterPrice) * 100 : 0;
    
    // Análise de direção
    const closingDirection = closingPrice > 0 ? 'positive' : 'negative';
    const afterDirection = afterSpread > 0 ? 'positive' : 'negative';
    const preDirection = preSpread > 0 ? 'positive' : 'negative';
    
    return {
        ticker,
        closingPrice: parseFloat(closingPrice.toFixed(2)),
        afterPrice: parseFloat(afterPrice.toFixed(2)),
        prePrice: parseFloat(prePrice.toFixed(2)),
        afterSpread: parseFloat(afterSpread.toFixed(4)),
        preSpread: parseFloat(preSpread.toFixed(4)),
        afterToPreSpread: parseFloat(afterToPreSpread.toFixed(4)),
        totalMovement: Math.max(0.01, Math.abs(afterSpread) + Math.abs(afterToPreSpread)),
        direction: {
            closing: closingDirection,
            after: afterDirection,
            pre: preDirection
        },
        hasPreMarket: prePercentage !== null && prePercentage !== undefined
    };
}

/**
 * Determina tipo de validação avançada com melhor interpretação
 * @param {Object} spreadAnalysis - Análise de spread
 * @returns {Object} Validação detalhada
 */
function determineAdvancedValidationType(spreadAnalysis) {
    if (!spreadAnalysis) {
        return {
            type: 'incomplete',
            icon: '⚪',
            status: CONFIG.UI.VALIDATION.INCOMPLETE,
            description: 'Faltam dados para análise',
            confidence: 0,
            recommendation: 'Aguardando dados de fechamento',
            color: COLOR_SCHEME.NEUTRAL
        };
    }
    
    const { afterSpread, preSpread, afterToPreSpread, direction, totalMovement, hasPreMarket, closingPrice } = spreadAnalysis;
    
    // Caso 1: Apenas dados de fechamento (sem after/pre)
    if ((!afterSpread || afterSpread === 0) && (!preSpread || preSpread === 0)) {
        // Calcular spread do fechamento (assumindo que closingPrice já é a variação)
        const closingSpread = closingPrice || 0;
        return analyzeClosingOnly(closingSpread);
    }
    
    // Caso 2: Apenas After-Market disponível
    if (!hasPreMarket) {
        return analyzeAfterMarketOnly(afterSpread, direction);
    }
    
    // Caso 3: After + Pré-Market disponíveis
    return analyzeAfterAndPreMarket(afterSpread, preSpread, afterToPreSpread, direction, totalMovement);
}

/**
 * Analisa apenas dados de After-Market
 */
function analyzeAfterMarketOnly(afterSpread, direction) {
    const absAfterSpread = Math.abs(afterSpread);
    
    if (absAfterSpread < 0.1) {
        return {
            type: 'after_neutral',
            icon: '🟡',
            status: 'After-Market Neutro',
            description: `Movimento mínimo no after-market (${afterSpread > 0 ? '+' : ''}${afterSpread.toFixed(2)}%)`,
            confidence: 60,
            recommendation: 'Aguardar pré-market para confirmação',
            color: COLOR_SCHEME.WARNING
        };
    }
    
    if (absAfterSpread < 1.0) {
        return {
            type: 'after_weak',
            icon: direction.after === 'positive' ? '🟢' : '🔴',
            status: `After-Market ${direction.after === 'positive' ? 'Positivo' : 'Negativo'} Fraco`,
            description: `Movimento moderado no after-market (${afterSpread > 0 ? '+' : ''}${afterSpread.toFixed(2)}%)`,
            confidence: 70,
            recommendation: direction.after === 'positive' ? 'Leve viés de alta' : 'Leve viés de baixa',
            color: getMovementColor(afterSpread)
        };
    }
    
    return {
        type: 'after_strong',
        icon: direction.after === 'positive' ? '🟢' : '🔴',
        status: `After-Market ${direction.after === 'positive' ? 'Positivo' : 'Negativo'} Forte`,
        description: `Movimento significativo no after-market (${afterSpread > 0 ? '+' : ''}${afterSpread.toFixed(2)}%)`,
        confidence: 85,
        recommendation: direction.after === 'positive' ? 'Forte viés de alta' : 'Forte viés de baixa',
        color: getMovementColor(afterSpread)
    };
}

/**
 * Analisa casos onde só há dados de fechamento (sem after/pre)
 */
function analyzeClosingOnly(closingSpread) {
    const absClosingSpread = Math.abs(closingSpread);
    
    if (absClosingSpread < 0.1) {
        return {
            type: 'closing_neutral',
            icon: '⚪',
            status: 'Apenas Fechamento - Neutro',
            description: `Mínimo: ${closingSpread > 0 ? '+' : ''}${closingSpread.toFixed(1)}%`,
            confidence: 30,
            recommendation: 'Aguardar dados',
            color: COLOR_SCHEME.NEUTRAL
        };
    }
    
    if (absClosingSpread < 1.0) {
        return {
            type: 'closing_weak',
            icon: closingSpread > 0 ? '🟢' : '🔴',
            status: `Apenas Fechamento - ${closingSpread > 0 ? 'Positivo' : 'Negativo'} Fraco`,
            description: `Moderado: ${closingSpread > 0 ? '+' : ''}${closingSpread.toFixed(1)}%`,
            confidence: 40,
            recommendation: closingSpread > 0 ? 'Leve viés de alta' : 'Leve viés de baixa',
            color: getMovementColor(closingSpread)
        };
    }
    
    return {
        type: 'closing_strong',
        icon: closingSpread > 0 ? '🟢' : '🔴',
        status: `Apenas Fechamento - ${closingSpread > 0 ? 'Positivo' : 'Negativo'} Forte`,
        description: `Significativo: ${closingSpread > 0 ? '+' : ''}${closingSpread.toFixed(1)}%`,
        confidence: 50,
        recommendation: closingSpread > 0 ? 'Forte viés de alta' : 'Forte viés de baixa',
        color: getMovementColor(closingSpread)
    };
}

/**
 * Analisa dados de After + Pré-Market
 */
function analyzeAfterAndPreMarket(afterSpread, preSpread, afterToPreSpread, direction, totalMovement) {
    // Caso 1: Mesma direção (After e Pré)
    if (direction.after === direction.pre) {
        return analyzeSameDirection(afterSpread, preSpread, afterToPreSpread, direction, totalMovement);
    }
    
    // Caso 2: Direções opostas
    return analyzeOppositeDirection(afterSpread, preSpread, afterToPreSpread, direction, totalMovement);
}

/**
 * Analisa quando After e Pré estão na mesma direção
 */
function analyzeSameDirection(afterSpread, preSpread, afterToPreSpread, direction, totalMovement) {
    // CORREÇÃO: Calcular diferença corretamente entre after e afterToPre
    const difference = Math.abs(afterSpread - afterToPreSpread);
    const isPositive = direction.after === 'positive';
    
    if (difference < 0.5) {
        return {
            type: 'confirmed_same_direction',
            icon: '✅',
            status: `Confirmação de ${isPositive ? 'Alta' : 'Baixa'}`,
            description: `Confirma ${isPositive ? 'alta' : 'baixa'} (dif: ${difference.toFixed(1)}%)`,
            confidence: 95,
            recommendation: `Forte sinal de ${isPositive ? 'compra' : 'venda'}`,
            color: isPositive ? COLOR_SCHEME.BULLISH : COLOR_SCHEME.BEARISH
        };
    }
    
    if (difference < 2.0) {
        return {
            type: 'weakened_same_direction',
            icon: '⚠️',
            status: `${isPositive ? 'Alta' : 'Baixa'} Enfraquecida`,
            description: `Mesma direção com divergência (${difference.toFixed(1)}%)`,
            confidence: 75,
            recommendation: `Sinal de ${isPositive ? 'compra' : 'venda'} com cautela`,
            color: COLOR_SCHEME.WARNING
        };
    }
    
    return {
        type: 'divergence_intensity',
        icon: '🟡',
        status: 'Divergência de Intensidade',
        description: `Diferença significativa (${difference.toFixed(1)}%)`,
        confidence: 60,
        recommendation: 'Aguardar confirmação',
        color: COLOR_SCHEME.WARNING
    };
}

/**
 * Analisa quando After e Pré estão em direções opostas
 */
function analyzeOppositeDirection(afterSpread, preSpread, afterToPreSpread, direction, totalMovement) {
    // FÓRMULA MATEMÁTICA PARA DIVERGÊNCIAS
    const divergenceAnalysis = calculateDivergenceType(afterSpread, afterToPreSpread, totalMovement);
    
    return divergenceAnalysis;
}

/**
 * Calcula tipo de divergência usando fórmula matemática precisa
 * @param {number} afterSpread - Spread do fechamento para after-market
 * @param {number} afterToPreSpread - Spread do after para pré-market
 * @param {number} totalMovement - Movimento total
 * @returns {Object} Análise da divergência
 */
function calculateDivergenceType(afterSpread, afterToPreSpread, totalMovement) {
    // FÓRMULA 1: Divergência Altista
    // Condição: After > 0 AND (After → Pré) > 0
    const isBullishDivergence = afterSpread > 0 && afterToPreSpread > 0;
    
    // FÓRMULA 2: Divergência Baixista  
    // Condição: After < 0 AND (After → Pré) < 0
    const isBearishDivergence = afterSpread < 0 && afterToPreSpread < 0;
    
    // FÓRMULA 3: Confirmação
    // Condição: Mesmo sinal em ambas as direções
    const isConfirmation = (afterSpread > 0 && afterToPreSpread > 0) || (afterSpread < 0 && afterToPreSpread < 0);
    
    // FÓRMULA 4: Intensidade
    const intensity = Math.abs(afterSpread) + Math.abs(afterToPreSpread);
    
    // FÓRMULA 5: Classificação por Intensidade
    const isStrong = intensity > 2.0;
    const isModerate = intensity > 1.0 && intensity <= 2.0;
    const isWeak = intensity <= 1.0;
    
    // ANÁLISE DE DIVERGÊNCIA ALTISTA
    if (isBullishDivergence) {
        if (isStrong) {
            return {
                type: 'strong_bullish_divergence',
                icon: '🟢',
                status: 'Divergência Altista Forte',
                description: `Reversão forte: +${afterSpread.toFixed(1)}% → +${afterToPreSpread.toFixed(1)}%`,
                confidence: 85,
                recommendation: 'Forte sinal de compra',
                color: COLOR_SCHEME.BULLISH,
                intensity: intensity,
                direction: 'bullish'
            };
        } else if (isModerate) {
            return {
                type: 'moderate_bullish_divergence',
                icon: '🟢',
                status: 'Divergência Altista Moderada',
                description: `Reversão moderada: +${afterSpread.toFixed(1)}% → +${afterToPreSpread.toFixed(1)}%`,
                confidence: 70,
                recommendation: 'Sinal de compra',
                color: COLOR_SCHEME.BULLISH,
                intensity: intensity,
                direction: 'bullish'
            };
        } else {
            return {
                type: 'weak_bullish_divergence',
                icon: '🟢',
                status: 'Divergência Altista Suave',
                description: `Reversão suave: +${afterSpread.toFixed(1)}% → +${afterToPreSpread.toFixed(1)}%`,
                confidence: 60,
                recommendation: 'Sinal fraco - Monitorar',
                color: COLOR_SCHEME.BULLISH,
                intensity: intensity,
                direction: 'bullish'
            };
        }
    }
    
    // ANÁLISE DE DIVERGÊNCIA BAIXISTA
    if (isBearishDivergence) {
        if (isStrong) {
            return {
                type: 'strong_bearish_divergence',
                icon: '🔴',
                status: 'Divergência Baixista Forte',
                description: `Reversão forte: ${afterSpread.toFixed(1)}% → ${afterToPreSpread.toFixed(1)}%`,
                confidence: 85,
                recommendation: 'Forte sinal de venda',
                color: COLOR_SCHEME.BEARISH,
                intensity: intensity,
                direction: 'bearish'
            };
        } else if (isModerate) {
            return {
                type: 'moderate_bearish_divergence',
                icon: '🔴',
                status: 'Divergência Baixista Moderada',
                description: `Reversão moderada: ${afterSpread.toFixed(1)}% → ${afterToPreSpread.toFixed(1)}%`,
                confidence: 70,
                recommendation: 'Sinal de venda',
                color: COLOR_SCHEME.BEARISH,
                intensity: intensity,
                direction: 'bearish'
            };
        } else {
            return {
                type: 'weak_bearish_divergence',
                icon: '🔴',
                status: 'Divergência Baixista Suave',
                description: `Reversão baixista suave: After ${afterSpread.toFixed(2)}% → Pré ${afterToPreSpread.toFixed(2)}%`,
                confidence: 60,
                recommendation: 'Leve sinal de venda - Aguardar confirmação',
                color: COLOR_SCHEME.BEARISH,
                intensity: intensity,
                direction: 'bearish'
            };
        }
    }
    
    // ANÁLISE DE CONFIRMAÇÃO
    if (isConfirmation) {
        const isPositive = afterSpread > 0;
        if (isStrong) {
            return {
                type: 'strong_confirmation',
                icon: '✅',
                status: `Confirmação ${isPositive ? 'Altista' : 'Baixista'} Forte`,
                description: `Confirmação forte: ${isPositive ? '+' : ''}${afterSpread.toFixed(1)}% → ${isPositive ? '+' : ''}${afterToPreSpread.toFixed(1)}%`,
                confidence: 95,
                recommendation: `Forte sinal de ${isPositive ? 'compra' : 'venda'}`,
                color: isPositive ? COLOR_SCHEME.BULLISH : COLOR_SCHEME.BEARISH,
                intensity: intensity,
                direction: isPositive ? 'bullish' : 'bearish'
            };
        } else if (isModerate) {
            return {
                type: 'moderate_confirmation',
                icon: '✅',
                status: `Confirmação ${isPositive ? 'Altista' : 'Baixista'} Moderada`,
                description: `Confirmação moderada: ${isPositive ? '+' : ''}${afterSpread.toFixed(1)}% → ${isPositive ? '+' : ''}${afterToPreSpread.toFixed(1)}%`,
                confidence: 80,
                recommendation: `Sinal de ${isPositive ? 'compra' : 'venda'}`,
                color: isPositive ? COLOR_SCHEME.BULLISH : COLOR_SCHEME.BEARISH,
                intensity: intensity,
                direction: isPositive ? 'bullish' : 'bearish'
            };
        } else {
            return {
                type: 'weak_confirmation',
                icon: '✅',
                status: `Confirmação ${isPositive ? 'Altista' : 'Baixista'} Suave`,
                description: `Confirmação suave: ${isPositive ? '+' : ''}${afterSpread.toFixed(1)}% → ${isPositive ? '+' : ''}${afterToPreSpread.toFixed(1)}%`,
                confidence: 65,
                recommendation: `Sinal fraco de ${isPositive ? 'compra' : 'venda'}`,
                color: isPositive ? COLOR_SCHEME.BULLISH : COLOR_SCHEME.BEARISH,
                intensity: intensity,
                direction: isPositive ? 'bullish' : 'bearish'
            };
        }
    }
    
    // CORREÇÃO: Verificar se há direções opostas (não é confirmação nem divergência)
    const hasOppositeDirections = (afterSpread > 0 && afterToPreSpread < 0) || (afterSpread < 0 && afterToPreSpread > 0);
    
    if (hasOppositeDirections) {
        return {
            type: 'neutral_divergence',
            icon: '🟡',
            status: 'Divergência Neutra',
            description: `Movimentos opostos: ${afterSpread > 0 ? '+' : ''}${afterSpread.toFixed(1)}% → ${afterToPreSpread > 0 ? '+' : ''}${afterToPreSpread.toFixed(1)}%`,
            confidence: 50,
            recommendation: 'Mercado indeciso',
                color: COLOR_SCHEME.WARNING,
            intensity: intensity,
            direction: 'neutral'
        };
    }
    
    // CASO PADRÃO: Divergência Neutra (fallback)
    return {
        type: 'neutral_divergence',
        icon: '🟡',
        status: 'Divergência Neutra',
        description: `Movimentos opostos: ${afterSpread > 0 ? '+' : ''}${afterSpread.toFixed(1)}% → ${afterToPreSpread > 0 ? '+' : ''}${afterToPreSpread.toFixed(1)}%`,
        confidence: 50,
        recommendation: 'Mercado indeciso',
                color: COLOR_SCHEME.WARNING,
        intensity: intensity,
        direction: 'neutral'
    };
}

/**
 * Atualiza display de validação na interface
 */
function updateValidationDisplay(ticker, validation) {
    const validationElement = document.getElementById(`validation-${ticker}`);
    if (!validationElement) return;
    
    validationElement.innerHTML = `
        <div class="validation-status">
            <div class="validation-icon">${validation.icon}</div>
            <div class="validation-details">
                <div class="validation-status-text">${validation.status}</div>
                <div class="validation-description">${validation.description}</div>
                <div class="validation-confidence">Confiança: ${validation.confidence}%</div>
            </div>
        </div>
    `;
    
    // Aplicar cor baseada no tipo
    validationElement.style.borderLeftColor = validation.color;
    validationElement.style.backgroundColor = `${validation.color}15`;
}

// ===== REGIME DE VOLATILIDADE ADAPTATIVO v2.5 =====

/**
 * Calcula a volatilidade dos ADRs baseada nos spreads
 * @returns {number} Volatilidade dos ADRs (desvio padrão dos totalMovement)
 */
function calculateADRsVolatility() {
    console.log('🔍 Calculando volatilidade dos ADRs...');
    const spreads = [];
    
    // Coletar spreads dos ADRs principais
    console.log('📊 Coletando dados dos ADRs principais...');
    adrsData.principais.forEach(adr => {
        console.log(`  Verificando ${adr.ticker}...`);
        const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
        if (spreadAnalysis && spreadAnalysis.totalMovement !== undefined) {
            console.log(`  ✅ ${adr.ticker}: totalMovement = ${spreadAnalysis.totalMovement.toFixed(2)}`);
            spreads.push(spreadAnalysis.totalMovement);
        } else {
            console.log(`  ❌ ${adr.ticker}: sem dados válidos`);
        }
    });
    
    // Coletar spreads dos ADRs secundários se habilitados
    if (appState.incluirSecundarios) {
        console.log('📊 Coletando dados dos ADRs secundários...');
        adrsData.secundarios.forEach(adr => {
            console.log(`  Verificando ${adr.ticker}...`);
            const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
            if (spreadAnalysis && spreadAnalysis.totalMovement !== undefined) {
                console.log(`  ✅ ${adr.ticker}: totalMovement = ${spreadAnalysis.totalMovement.toFixed(2)}`);
                spreads.push(spreadAnalysis.totalMovement);
            } else {
                console.log(`  ❌ ${adr.ticker}: sem dados válidos`);
            }
        });
    }
    
    // Se não há dados suficientes, retornar volatilidade padrão
    if (spreads.length < 2) {
        console.log('📊 Volatilidade ADRs: Dados insuficientes, usando padrão 1.0');
        console.log(`  Spreads encontrados: ${spreads.length}`);
        console.log('  ⚠️ ADRs sem dados válidos - verificar inputs');
        
        // CORREÇÃO: Retornar valor padrão realista
        return 1.0; // Volatilidade padrão
    }
    
    // Calcular desvio padrão
    const mean = spreads.reduce((a, b) => a + b) / spreads.length;
    const variance = spreads.reduce((a, b) => a + Math.pow(b - mean, 2)) / spreads.length;
    const standardDeviation = Math.sqrt(variance);
    
    console.log('📊 Volatilidade ADRs calculada:', {
        spreads: spreads.length,
        mean: mean.toFixed(2),
        standardDeviation: standardDeviation.toFixed(2),
        spreads: spreads.map(s => s.toFixed(2))
    });
    
    return standardDeviation;
}

/**
 * Calcula Timing Effect baseado na literatura sobre after-hours trading
 * Base Acadêmica: Research sobre after-hours trading
 * @returns {Object} Efeito de timing
 */
function calculateTimingEffectScore() {
    const currentTime = new Date();
    const hour = currentTime.getHours();
    
    console.log(`⏰ Calculando Timing Effect - Hora atual: ${hour}h`);
    
    // Baseado na literatura: after-hours tem menos liquidez, pre-market mais volátil
    let timingMultiplier = 1.0;
    let confidenceAdjustment = 1.0;
    let period = 'REGULAR_HOURS';
    let recommendation = 'NORMAL';
    
    // After-hours effect (16h-20h ET = 17h-21h BRT)
    if (hour >= 17 && hour <= 21) {
        timingMultiplier = 0.8; // Menor confiança em after-hours
        confidenceAdjustment = 0.85;
        period = 'AFTER_HOURS';
        recommendation = 'REDUZIR_POSIÇÃO';
    }
    // Pre-market effect (4h-9:30h ET = 5h-10:30h BRT)  
    else if (hour >= 5 && hour <= 10) {
        timingMultiplier = 1.2; // Maior impacto em pre-market
        confidenceAdjustment = 1.1;
        period = 'PRE_MARKET';
        recommendation = 'AUMENTAR_POSIÇÃO';
    }
    // Regular hours (10h-17h BRT)
    else if (hour >= 10 && hour <= 17) {
        timingMultiplier = 1.0;
        confidenceAdjustment = 1.0;
        period = 'REGULAR_HOURS';
        recommendation = 'NORMAL';
    }
    // Overnight (literature shows lower reliability)
    else {
        timingMultiplier = 0.6;
        confidenceAdjustment = 0.7;
        period = 'OVERNIGHT';
        recommendation = 'REDUZIR_POSIÇÃO';
    }
    
    const result = {
        multiplier: timingMultiplier,
        confidence: confidenceAdjustment,
        period: period,
        recommendation: recommendation,
        hour: hour
    };
    
    console.log(`  ✅ Timing: ${period}, Multiplier ${timingMultiplier.toFixed(2)}, Confidence ${confidenceAdjustment.toFixed(2)}`);
    
    return result;
}

/**
 * Calcula Mean Reversion Strength para ADRs baseado no modelo Ornstein-Uhlenbeck
 * Base Acadêmica: Paper sobre mean reversion em ADRs
 * @returns {Object} Scores de mean reversion por ADR
 */
function calculateMeanReversionStrength() {
    console.log('🔄 Calculando Mean Reversion Strength...');
    
    const meanReversionScores = {};
    let totalADRs = 0;
    let validADRs = 0;
    
    // Processar ADRs principais
    if (adrsData && adrsData.principais) {
        adrsData.principais.forEach(adr => {
            totalADRs++;
            console.log(`  📊 Analisando ${adr.ticker}...`);
            
            const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
            if (!spreadAnalysis) {
                console.log(`    ❌ ${adr.ticker}: sem dados de spread`);
                return;
            }
            
            // Fórmula baseada no modelo Ornstein-Uhlenbeck
            const currentSpread = spreadAnalysis.preSpread || 0;
            const meanSpread = 0; // Long-term mean = 0
            const revertSpeed = 0.5; // θ (theta) parameter
            const volatility = Math.abs(currentSpread) || 1; // Evitar divisão por zero
            
            // Mean reversion force = θ(μ - X_t)
            const reversionForce = revertSpeed * (meanSpread - currentSpread);
            
            // Strength based on Z-score
            const zScore = Math.abs(currentSpread) / volatility;
            const reversionProbability = Math.min(0.95, Math.max(0.05, 1 / (1 + Math.exp(-zScore))));
            
            // Classificar sinal
            let signal = 'WEAK_SIGNAL';
            if (zScore > 2.0) {
                signal = 'STRONG_REVERSION';
            } else if (zScore > 1.5) {
                signal = 'MODERATE_REVERSION';
            }
            
            meanReversionScores[adr.ticker] = {
                force: reversionForce,
                probability: reversionProbability,
                strength: zScore,
                signal: signal,
                currentSpread: currentSpread,
                volatility: volatility
            };
            
            validADRs++;
            console.log(`    ✅ ${adr.ticker}: Z-score ${zScore.toFixed(2)}, Signal ${signal}`);
        });
    }
    
    // Processar ADRs secundários se habilitados
    if (appState.incluirSecundarios && adrsData && adrsData.secundarios) {
        adrsData.secundarios.forEach(adr => {
            totalADRs++;
            console.log(`  📊 Analisando ${adr.ticker} (secundário)...`);
            
            const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
            if (!spreadAnalysis) {
                console.log(`    ❌ ${adr.ticker}: sem dados de spread`);
                return;
            }
            
            const currentSpread = spreadAnalysis.preSpread || 0;
            const meanSpread = 0;
            const revertSpeed = 0.5;
            const volatility = Math.abs(currentSpread) || 1;
            
            const reversionForce = revertSpeed * (meanSpread - currentSpread);
            const zScore = Math.abs(currentSpread) / volatility;
            const reversionProbability = Math.min(0.95, Math.max(0.05, 1 / (1 + Math.exp(-zScore))));
            
            let signal = 'WEAK_SIGNAL';
            if (zScore > 2.0) {
                signal = 'STRONG_REVERSION';
            } else if (zScore > 1.5) {
                signal = 'MODERATE_REVERSION';
            }
            
            meanReversionScores[adr.ticker] = {
                force: reversionForce,
                probability: reversionProbability,
                strength: zScore,
                signal: signal,
                currentSpread: currentSpread,
                volatility: volatility
            };
            
            validADRs++;
            console.log(`    ✅ ${adr.ticker}: Z-score ${zScore.toFixed(2)}, Signal ${signal}`);
        });
    }
    
    console.log(`📊 Mean Reversion calculado: ${validADRs}/${totalADRs} ADRs válidos`);
    
    return {
        scores: meanReversionScores,
        summary: {
            totalADRs: totalADRs,
            validADRs: validADRs,
            strongSignals: Object.values(meanReversionScores).filter(s => s.signal === 'STRONG_REVERSION').length,
            moderateSignals: Object.values(meanReversionScores).filter(s => s.signal === 'MODERATE_REVERSION').length,
            weakSignals: Object.values(meanReversionScores).filter(s => s.signal === 'WEAK_SIGNAL').length
        }
    };
}

/**
 * Calcula Information Ratio para seleção dinâmica de ADRs
 * Base Acadêmica: Papers sobre Information Ratio
 * @returns {Object} Information Ratios por ADR
 */
function calculateADRInformationRatios() {
    console.log('📊 Calculando Information Ratios dos ADRs...');
    
    const informationRatios = {};
    let totalADRs = 0;
    let validADRs = 0;
    
    // Benchmark = 0 (IBOV como referência)
    const benchmark = 0;
    
    // Processar ADRs principais
    if (adrsData && adrsData.principais) {
        adrsData.principais.forEach(adr => {
            totalADRs++;
            console.log(`  📈 Analisando IR de ${adr.ticker}...`);
            
            const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
            if (!spreadAnalysis) {
                console.log(`    ❌ ${adr.ticker}: sem dados de spread`);
                return;
            }
            
            // Calcular retornos ativos vs benchmark
            const activeReturn = spreadAnalysis.preSpread - benchmark;
            
            // Tracking error (volatilidade dos retornos ativos)
            const trackingError = Math.abs(spreadAnalysis.afterToPreSpread) || 1; // Evitar divisão por zero
            
            // Information Ratio = Active Return / Tracking Error
            const informationRatio = activeReturn / trackingError;
            
            // Peso dinâmico baseado no IR (com limites seguros)
            const irWeight = Math.max(0.5, Math.min(2.0, 1 + (informationRatio * 0.3)));
            
            // Classificar qualidade
            let quality = 'LOW';
            if (informationRatio > 0.5) {
                quality = 'HIGH';
            } else if (informationRatio > 0) {
                quality = 'MEDIUM';
            }
            
            informationRatios[adr.ticker] = {
                ir: informationRatio,
                activeReturn: activeReturn,
                trackingError: trackingError,
                dynamicWeight: irWeight,
                quality: quality,
                originalWeight: adr.pesoibovespa || 1.0
            };
            
            validADRs++;
            console.log(`    ✅ ${adr.ticker}: IR ${informationRatio.toFixed(3)}, Weight ${irWeight.toFixed(2)}, Quality ${quality}`);
        });
    }
    
    // Processar ADRs secundários se habilitados
    if (appState.incluirSecundarios && adrsData && adrsData.secundarios) {
        adrsData.secundarios.forEach(adr => {
            totalADRs++;
            console.log(`  📈 Analisando IR de ${adr.ticker} (secundário)...`);
            
            const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
            if (!spreadAnalysis) {
                console.log(`    ❌ ${adr.ticker}: sem dados de spread`);
                return;
            }
            
            const activeReturn = spreadAnalysis.preSpread - benchmark;
            const trackingError = Math.abs(spreadAnalysis.afterToPreSpread) || 1;
            const informationRatio = activeReturn / trackingError;
            const irWeight = Math.max(0.5, Math.min(2.0, 1 + (informationRatio * 0.3)));
            
            let quality = 'LOW';
            if (informationRatio > 0.5) {
                quality = 'HIGH';
            } else if (informationRatio > 0) {
                quality = 'MEDIUM';
            }
            
            informationRatios[adr.ticker] = {
                ir: informationRatio,
                activeReturn: activeReturn,
                trackingError: trackingError,
                dynamicWeight: irWeight,
                quality: quality,
                originalWeight: adr.pesoibovespa || 1.0
            };
            
            validADRs++;
            console.log(`    ✅ ${adr.ticker}: IR ${informationRatio.toFixed(3)}, Weight ${irWeight.toFixed(2)}, Quality ${quality}`);
        });
    }
    
    console.log(`📊 Information Ratios calculados: ${validADRs}/${totalADRs} ADRs válidos`);
    
    return {
        ratios: informationRatios,
        summary: {
            totalADRs: totalADRs,
            validADRs: validADRs,
            highQuality: Object.values(informationRatios).filter(r => r.quality === 'HIGH').length,
            mediumQuality: Object.values(informationRatios).filter(r => r.quality === 'MEDIUM').length,
            lowQuality: Object.values(informationRatios).filter(r => r.quality === 'LOW').length,
            avgIR: validADRs > 0 ? Object.values(informationRatios).reduce((sum, r) => sum + r.ir, 0) / validADRs : 0
        }
    };
}

/**
 * Detecta Volatility Clustering baseado na literatura acadêmica
 * Base Acadêmica: Mandelbrot (1963) - "mudanças grandes tendem a ser seguidas por mudanças grandes"
 * @returns {Object} Dados de clustering detectado
 */
function detectVolatilityClustering() {
    console.log('🌊 Detectando Volatility Clustering...');
    
    const currentTime = Date.now();
    const adrs = [...adrsData.principais, ...(appState.incluirSecundarios ? adrsData.secundarios : [])];
    
    // 1. Calcular volatilidade atual dos ADRs
    let currentVolatilities = [];
    let avgVolatility = 0;
    
    adrs.forEach(adr => {
        const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
        if (spreadAnalysis) {
            // Volatilidade = |spread pré-market|
            const currentVol = Math.abs(spreadAnalysis.preSpread || 0);
            currentVolatilities.push({
                ticker: adr.ticker,
                volatility: currentVol,
                weight: adr.peso_ibovespa * adr.liquidez_weight
            });
            avgVolatility += currentVol;
            console.log(`    📊 ${adr.ticker}: Vol ${currentVol.toFixed(2)}%`);
        }
    });
    
    if (currentVolatilities.length === 0) {
        console.log('  ❌ Sem dados de volatilidade para análise');
        return { 
            clustering: false, 
            intensity: 0,
            avgVolatility: 0,
            recommendation: generateClusteringRecommendation({ clustering: false, intensity: 0 }, 0)
        };
    }
    
    avgVolatility = avgVolatility / currentVolatilities.length;
    console.log(`  📊 Volatilidade média: ${avgVolatility.toFixed(2)}%`);
    
    // 2. Atualizar histórico de volatilidade
    const today = new Date().toDateString();
    if (!appState.volatilityClustering.history.has(today)) {
        appState.volatilityClustering.history.set(today, []);
    }
    
    const todayHistory = appState.volatilityClustering.history.get(today);
    todayHistory.push({
        timestamp: currentTime,
        avgVolatility: avgVolatility,
        maxVolatility: Math.max(...currentVolatilities.map(v => v.volatility))
    });
    
    // Manter apenas últimos 10 registros do dia
    if (todayHistory.length > 10) todayHistory.shift();
    
    // 3. Detectar clustering através de autocorrelação
    let clusteringResult = { clustering: false, intensity: 0 };
    
    if (todayHistory.length >= 3) {
        const volatilities = todayHistory.map(h => h.avgVolatility);
        const clusteringScore = calculateVolatilityAutocorrelation(volatilities);
        
        // Clustering detectado se autocorrelação > 0.3
        const isClusteringActive = clusteringScore > 0.3;
        
        // 4. Calcular intensidade e duração
        if (isClusteringActive) {
            clusteringResult = {
                clustering: true,
                intensity: Math.min(2.0, clusteringScore * 2),
                duration: appState.volatilityClustering.duration + 1,
                avgVolatility: avgVolatility,
                score: clusteringScore
            };
            appState.volatilityClustering.duration = clusteringResult.duration;
            appState.volatilityClustering.isActive = true;
            appState.volatilityClustering.intensity = clusteringResult.intensity;
        } else {
            clusteringResult = {
                clustering: false,
                intensity: 0,
                duration: Math.max(0, appState.volatilityClustering.duration - 1),
                avgVolatility: avgVolatility,
                score: clusteringScore
            };
            appState.volatilityClustering.duration = clusteringResult.duration;
            appState.volatilityClustering.isActive = clusteringResult.duration > 0;
            appState.volatilityClustering.intensity = 0;
        }
        
        // 5. Gerar recomendação
        clusteringResult.recommendation = generateClusteringRecommendation(clusteringResult, avgVolatility);
        appState.volatilityClustering.recommendation = clusteringResult.recommendation;
        
        console.log(`  ✅ Clustering: ${clusteringResult.clustering ? 'ATIVO' : 'INATIVO'}`);
        console.log(`    📊 Intensidade: ${clusteringResult.intensity.toFixed(2)}`);
        console.log(`    ⏱️ Duração: ${clusteringResult.duration}`);
        console.log(`    🎯 Recomendação: ${clusteringResult.recommendation.action}`);
    } else {
        clusteringResult.recommendation = generateClusteringRecommendation({ clustering: false, intensity: 0 }, avgVolatility);
        console.log(`  ⏳ Coletando dados (${todayHistory.length}/3 registros necessários)`);
    }
    
    appState.volatilityClustering.lastUpdate = currentTime;
    
    return clusteringResult;
}

/**
 * Calcula autocorrelação de volatilidade (lag-1)
 */
function calculateVolatilityAutocorrelation(volatilities) {
    if (volatilities.length < 3) return 0;
    
    const mean = volatilities.reduce((a,b) => a+b) / volatilities.length;
    let numerator = 0;
    let denominator = 0;
    
    // Autocorrelação lag-1 (correlação com período anterior)
    for (let i = 1; i < volatilities.length; i++) {
        numerator += (volatilities[i] - mean) * (volatilities[i-1] - mean);
        denominator += Math.pow(volatilities[i] - mean, 2);
    }
    
    const autocorrelation = denominator > 0 ? numerator / denominator : 0;
    console.log(`    🔍 Autocorrelação: ${autocorrelation.toFixed(3)}`);
    
    return autocorrelation;
}

/**
 * Gera recomendação baseada no clustering detectado
 */
function generateClusteringRecommendation(clusteringData, avgVolatility) {
    if (clusteringData.intensity > 1.5) {
        return {
            signal: 'ALTA_VOLATILIDADE_PERSISTENTE',
            action: 'REDUZIR_TAMANHO_POSIÇÃO',
            confidence: 'ALTA',
            description: 'Clustering forte detectado. Volatilidade deve persistir.',
            multiplier: 0.7 // Reduzir peso dos sinais
        };
    } else if (clusteringData.intensity > 0.8) {
        return {
            signal: 'VOLATILIDADE_MODERADA_CLUSTERING',
            action: 'AJUSTAR_STOPS',
            confidence: 'MÉDIA',
            description: 'Clustering moderado. Aumentar cautela.',
            multiplier: 0.85
        };
    } else if (avgVolatility < 0.5 && !clusteringData.clustering) {
        return {
            signal: 'BAIXA_VOLATILIDADE',
            action: 'PREPARAR_PARA_BREAKOUT',
            confidence: 'MÉDIA',
            description: 'Baixa volatilidade. Possível breakout próximo.',
            multiplier: 1.1 // Aumentar peso dos sinais
        };
    } else {
        return {
            signal: 'VOLATILIDADE_NORMAL',
            action: 'OPERAÇÃO_NORMAL',
            confidence: 'BAIXA',
            description: 'Nenhum clustering significativo detectado.',
            multiplier: 1.0
        };
    }
}

/**
 * Atualiza o regime de volatilidade baseado em VIX e volatilidade dos ADRs
 * @returns {number} Multiplicador para peso macro
 */
function updateVolatilityRegime() {
    const vixLevel = appState.vixData.absolute || 20;
    const vixChange = Math.abs(appState.vixData.variation || 0);
    
    // Calcular volatilidade dos ADRs
    const adrVolatility = calculateADRsVolatility();
    appState.adrsVolatility = adrVolatility;
    
    let regime = 'normal';
    let multiplier = 1.0;
    let description = 'Regime Normal';
    let color = '🟡';
    
    // Determinar regime baseado em VIX e volatilidade dos ADRs (REFINADO v2.5)
    if (vixLevel > 50) {
        // NOVO: Regime de Crise (baseado na literatura acadêmica)
        regime = 'crisis';
        multiplier = 2.2;
        description = 'Regime de Crise';
        color = '🟣';
    } else if (vixLevel > 35 || adrVolatility > 2.5) {
        regime = 'extreme';
        multiplier = 1.6;
        description = 'Regime Extremo';
        color = '⚫';
    } else if (vixLevel > 25 || adrVolatility > 1.5) {
        regime = 'high';
        multiplier = 1.3;
        description = 'Regime Alto';
        color = '🔴';
    } else if (vixLevel < 12 && adrVolatility < 0.8) {
        // REFINADO: Threshold mais preciso (15 → 12)
        regime = 'low';
        multiplier = 0.7;
        description = 'Regime Baixo';
        color = '🟢';
    } else {
        regime = 'normal';
        multiplier = 1.0;
        description = 'Regime Normal';
        color = '🟡';
    }
    
    // Atualizar estado
    appState.volatilityRegime = regime;
    appState.regimeMultiplier = multiplier;
    
    console.log('🔄 Regime de Volatilidade Atualizado:', {
        regime,
        multiplier,
        description,
        vixLevel,
        adrVolatility: adrVolatility.toFixed(2),
        color
    });
    
    return {
        regime,
        multiplier,
        description,
        color,
        vixLevel,
        adrVolatility,
        details: {
            vixCondition: vixLevel > 35 ? 'VIX > 35' : vixLevel > 25 ? 'VIX > 25' : vixLevel < 15 ? 'VIX < 15' : 'VIX Normal',
            adrCondition: adrVolatility > 2.5 ? 'ADRs > 2.5' : adrVolatility > 1.5 ? 'ADRs > 1.5' : adrVolatility < 0.8 ? 'ADRs < 0.8' : 'ADRs Normal'
        }
    };
}

/**
 * Atualiza a interface do regime de volatilidade
 */
function updateVolatilityRegimeInterface() {
    const regimeElement = document.getElementById('volatilityRegime');
    const regimeIcon = document.getElementById('regimeIcon');
    const regimeText = document.getElementById('regimeText');
    const regimeMultiplier = document.getElementById('regimeMultiplier');
    const adrsVolatility = document.getElementById('adrsVolatility');
    const adjustedMacroWeight = document.getElementById('adjustedMacroWeight');
    const timingEffect = document.getElementById('timingEffect');
    const timingPeriod = document.getElementById('timingPeriod');
    
    if (!regimeElement || !regimeIcon || !regimeText) return;
    
    // Obter dados do regime atual
    const regime = appState.volatilityRegime;
    const multiplier = appState.regimeMultiplier;
    const adrVol = appState.adrsVolatility;
    
    // Atualizar ícone e texto (REFINADO v2.5)
    const regimeConfig = {
        'low': { icon: '🟢', text: 'Baixo', color: '#28a745' },
        'normal': { icon: '🟡', text: 'Normal', color: '#ffc107' },
        'high': { icon: '🔴', text: 'Alto', color: '#fd7e14' },
        'extreme': { icon: '⚫', text: 'Extremo', color: '#dc3545' },
        'crisis': { icon: '🟣', text: 'Crise', color: '#8b5cf6' } // NOVO: Regime de Crise
    };
    
    const config = regimeConfig[regime] || regimeConfig['normal'];
    
    regimeIcon.textContent = config.icon;
    regimeText.textContent = config.text;
    regimeElement.setAttribute('data-regime', regime);
    
    // Atualizar métricas
    if (regimeMultiplier) {
        regimeMultiplier.textContent = `${multiplier.toFixed(1)}x`;
        regimeMultiplier.style.color = config.color;
    }
    
    if (adrsVolatility) {
        adrsVolatility.textContent = adrVol.toFixed(2);
        adrsVolatility.style.color = adrVol > 1.5 ? '#dc3545' : adrVol < 0.8 ? '#28a745' : '#6c757d';
    }
    
    if (adjustedMacroWeight) {
        const adjustedWeight = appState.pesoMacro * multiplier;
        adjustedMacroWeight.textContent = `${adjustedWeight.toFixed(1)}%`;
        adjustedMacroWeight.style.color = config.color;
    }
    
    // Atualizar métricas do Timing Effect (NOVO v2.5)
    if (timingEffect && appState.timingEffect) {
        const timing = appState.timingEffect;
        timingEffect.textContent = `${timing.multiplier.toFixed(1)}x`;
        timingEffect.style.color = timing.multiplier > 1.0 ? '#28a745' : timing.multiplier < 1.0 ? '#dc3545' : '#6c757d';
    }
    
    if (timingPeriod && appState.timingEffect) {
        const timing = appState.timingEffect;
        const periodLabels = {
            'AFTER_HOURS': 'After-Hours',
            'PRE_MARKET': 'Pré-Market',
            'REGULAR_HOURS': 'Horário Normal',
            'OVERNIGHT': 'Overnight'
        };
        timingPeriod.textContent = periodLabels[timing.period] || timing.period;
        timingPeriod.style.color = timing.multiplier > 1.0 ? '#28a745' : timing.multiplier < 1.0 ? '#dc3545' : '#6c757d';
    }
    
    console.log('🎨 Interface do Regime de Volatilidade atualizada:', {
        regime,
        multiplier,
        adrVolatility: adrVol,
        adjustedWeight: appState.pesoMacro * multiplier
    });
}


/**
 * Atualiza análise de spread detalhada na interface
 */
function updateSpreadAnalysis() {
    const spreadContainer = document.getElementById('spreadAnalysisContainer');
    if (!spreadContainer) return;
    
    let spreadHTML = '<div class="spread-analysis-grid">';
    let hasData = false;
    
    // Analisar ADRs principais
    adrsData.principais.forEach(adr => {
        const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
        if (spreadAnalysis) {
            hasData = true;
            spreadHTML += createSpreadCard(adr, spreadAnalysis);
        }
    });
    
    // Analisar ADRs secundários se habilitados
    if (appState.incluirSecundarios) {
        adrsData.secundarios.forEach(adr => {
            const spreadAnalysis = getSpreadAnalysisForADR(adr.ticker);
            if (spreadAnalysis) {
                hasData = true;
                spreadHTML += createSpreadCard(adr, spreadAnalysis);
            }
        });
    }
    
    spreadHTML += '</div>';
    
    if (!hasData) {
        spreadHTML = `
            <div class="spread-analysis-placeholder">
                <div class="placeholder-icon">📈</div>
                <div class="placeholder-text">
                    <h4>Análise de Spread Aguardando Dados</h4>
                    <p>Insira os preços de fechamento e variações para ver a análise detalhada de spreads</p>
                </div>
            </div>
        `;
    }
    
    spreadContainer.innerHTML = spreadHTML;
}

/**
 * Obtém análise de spread para um ADR específico
 */
function getSpreadAnalysisForADR(ticker) {
    const closingInput = document.getElementById(`closing-${ticker}`);
    const afterInput = document.getElementById(`after-${ticker}`);
    const preInput = document.getElementById(`pre-${ticker}`);
    
    if (!closingInput || !afterInput || !preInput) {
        return null;
    }
    
    // CORREÇÃO: Pegar o preço real de fechamento do yfinance (não a porcentagem)
    const closingPrice = getRealClosingPrice(ticker);
    const afterPercentage = parseFloat(afterInput.value) || 0;
    const prePercentage = parseFloat(preInput.value) || 0;
    
    if (!closingPrice || closingPrice <= 0) return null;
    
    return calculateRealSpreadAnalysis(ticker, closingPrice, afterPercentage, prePercentage);
}

/**
 * Obtém o preço real de fechamento do yfinance para um ADR
 */
function getRealClosingPrice(ticker) {
    // PRIORIDADE 1: Dados do yfinance (mais confiável)
    if (window.adrPrices && window.adrPrices[ticker]) {
        const data = window.adrPrices[ticker];
        if (data.price && data.price > 0) {
            // Validar idade dos dados (máximo 5 minutos)
            if (data.timestamp) {
                const dataAge = Date.now() - new Date(data.timestamp).getTime();
                if (dataAge < 300000) { // 5 minutos
                    // console.log(`✅ Preço real ${ticker}: R$ ${data.price} (dados frescos)`);
                    return data.price;
                } else {
                    console.warn(`⚠️ Dados antigos ${ticker} (${Math.round(dataAge/1000)}s), mas usando: R$ ${data.price}`);
                    return data.price;
                }
            } else {
                // console.log(`✅ Preço real ${ticker}: R$ ${data.price} (sem timestamp)`);
                return data.price;
            }
        }
    }
    
    // PRIORIDADE 2: Tentar buscar dados atualizados
    if (window.adrPrices && window.adrPrices[ticker] && window.adrPrices[ticker].timestamp) {
        const dataAge = Date.now() - new Date(window.adrPrices[ticker].timestamp).getTime();
        if (dataAge < 300000) { // 5 minutos
            console.log(`⚠️ Dados antigos ${ticker}, mas usando: R$ ${window.adrPrices[ticker].price}`);
            return window.adrPrices[ticker].price;
        }
    }
    
    // PRIORIDADE 3: Parsing da interface (mais confiável que hardcoded)
    const priceDisplay = document.querySelector(`[data-ticker="${ticker}"] .price-display`);
    if (priceDisplay) {
        const priceText = priceDisplay.textContent;
        const priceMatch = priceText.match(/R\$\s*([\d,]+\.?\d*)/);
        if (priceMatch) {
            const price = parseFloat(priceMatch[1].replace(',', ''));
            if (validatePriceData(price, ticker)) {
                // console.log(`📱 Preço da interface ${ticker}: R$ ${price}`);
                return price;
            }
        }
    }
    
    // PRIORIDADE 4: Preços padrão (último recurso)
    const defaultPrices = {
        'VALE': 10.84, 'ITUB': 15.50, 'PBR': 8.90, 'PBR-A': 12.30,
        'BBD': 25.00, 'BBDO': 18.75, 'ERJ': 14.20, 'ABEV': 12.45,
        'VIVT3': 45.60, 'WEGE3': 28.90, 'MGLU3': 15.80, 'RENT3': 22.40,
        'SUZB3': 18.30, 'RADL3': 35.20, 'CYRE3': 12.10, 'JBSS3': 28.50,
        'LREN3': 42.80, 'MULT3': 38.90, 'RAIL3': 15.60, 'SLCE3': 22.70,
        'TOTS3': 31.40, 'USIM5': 8.45, 'VULC3': 19.20, 'WIZS3': 16.80,
        'YDUQ3': 24.30
    };
    
    if (defaultPrices[ticker]) {
        // console.warn(`⚠️ Usando preço padrão ${ticker}: R$ ${defaultPrices[ticker]}`);
        return defaultPrices[ticker];
    }
    
    console.error(`❌ Preço não encontrado para ${ticker}`);
    return null;
}

// Função auxiliar para validar dados de preço
function validatePriceData(price, ticker) {
    if (!price || price <= 0) {
        // console.warn(`❌ Preço inválido para ${ticker}: ${price}`);
        return false;
    }
    
    if (price < 1 || price > 1000) {
        // console.warn(`⚠️ Preço suspeito para ${ticker}: R$ ${price}`);
        return false;
    }
    
    return true;
}

// Função centralizada para validar dados de entrada
function validateInputData(ticker, afterValue, closingValue, preValue) {
    const errors = [];
    const warnings = [];
    
    // Validar ticker
    if (!ticker || typeof ticker !== 'string') {
        errors.push('Ticker inválido');
    }
    
    // Validar valores numéricos
    const values = { after: afterValue, closing: closingValue, pre: preValue };
    Object.entries(values).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
            if (typeof value !== 'number' || isNaN(value)) {
                errors.push(`${key} deve ser um número válido`);
            } else if (Math.abs(value) > 50) {
                warnings.push(`${key} muito alto: ${value}%`);
            } else if (Math.abs(value) < 0.01 && value !== 0) {
                warnings.push(`${key} muito baixo: ${value}%`);
            }
        }
    });
    
    // Validar consistência
    if (afterValue !== null && preValue !== null) {
        const spread = Math.abs(afterValue - preValue);
        if (spread > 20) {
            warnings.push(`Diferença muito alta entre after e pré: ${spread}%`);
        }
    }
    
    return { errors, warnings, isValid: errors.length === 0 };
}

// Função para validar inputs numéricos na interface
function validateNumericInput(value, min, max) {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    
    const numValue = parseFloat(value);
    
    if (isNaN(numValue)) {
        return null;
    }
    
    if (min !== undefined && numValue < min) {
        // console.warn(`Valor muito baixo: ${numValue} < ${min}`);
        return min;
    }
    
    if (max !== undefined && numValue > max) {
        // console.warn(`Valor muito alto: ${numValue} > ${max}`);
        return max;
    }
    
    return numValue;
}

/**
 * Cria card de análise de spread para um ADR
 */
function createSpreadCard(adr, spreadAnalysis) {
    const validation = determineAdvancedValidationType(spreadAnalysis);
    
    return `
        <div class="spread-card">
            <div class="spread-card-header">
                <div class="spread-ticker">${adr.ticker}</div>
                <div class="spread-company">${adr.nome}</div>
                <div class="spread-validation" style="color: ${validation.color}">
                    ${validation.icon} ${validation.status}
                </div>
            </div>
            
            <div class="spread-prices">
                <div class="price-row">
                    <span class="price-label">Fechamento:</span>
                    <span class="price-value">$ ${spreadAnalysis.closingPrice.toFixed(2)}</span>
                </div>
                <div class="price-row">
                    <span class="price-label">After-Market:</span>
                    <span class="price-value">$ ${spreadAnalysis.afterPrice.toFixed(2)}</span>
                    <span class="price-change ${spreadAnalysis.afterSpread > 0 ? 'positive' : 'negative'}">
                        ${spreadAnalysis.afterSpread > 0 ? '+' : ''}${spreadAnalysis.afterSpread.toFixed(2)}%
                    </span>
                </div>
                ${spreadAnalysis.hasPreMarket ? `
                <div class="price-row">
                    <span class="price-label">Pré-Market:</span>
                    <span class="price-value">$ ${spreadAnalysis.prePrice.toFixed(2)}</span>
                    <span class="price-change ${spreadAnalysis.preSpread > 0 ? 'positive' : 'negative'}">
                        ${spreadAnalysis.preSpread > 0 ? '+' : ''}${spreadAnalysis.preSpread.toFixed(2)}%
                    </span>
                </div>
                ` : ''}
            </div>
            
            <div class="spread-metrics">
                <div class="metric-row">
                    <span class="metric-label">Fechamento → After:</span>
                    <span class="metric-value ${spreadAnalysis.afterSpread > 0 ? 'positive' : 'negative'}">
                        ${spreadAnalysis.afterSpread > 0 ? '+' : ''}${spreadAnalysis.afterSpread.toFixed(2)}%
                    </span>
                </div>
                ${spreadAnalysis.hasPreMarket ? `
                <div class="metric-row">
                    <span class="metric-label">After → Pré:</span>
                    <span class="metric-value ${spreadAnalysis.afterToPreSpread > 0 ? 'positive' : 'negative'}">
                        ${spreadAnalysis.afterToPreSpread > 0 ? '+' : ''}${spreadAnalysis.afterToPreSpread.toFixed(2)}%
                    </span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Fechamento → Pré (Total):</span>
                    <span class="metric-value ${spreadAnalysis.preSpread > 0 ? 'positive' : 'negative'}">
                        ${spreadAnalysis.preSpread > 0 ? '+' : ''}${spreadAnalysis.preSpread.toFixed(2)}%
                    </span>
                </div>
                <div class="metric-row">
                    <span class="metric-label">Movimento Total:</span>
                    <span class="metric-value">${spreadAnalysis.totalMovement.toFixed(2)}%</span>
                </div>
                ` : `
                <div class="metric-row">
                    <span class="metric-label">Movimento Total:</span>
                    <span class="metric-value">${Math.abs(spreadAnalysis.afterSpread).toFixed(2)}%</span>
                </div>
                `}
            </div>
            
            <div class="spread-recommendation">
                <div class="recommendation-text">${validation.recommendation}</div>
                <div class="confidence-badge" style="background-color: ${validation.color}20; color: ${validation.color}; border-color: ${validation.color}40;">
                    Confiança: ${validation.confidence}%
                </div>
            </div>
        </div>
    `;
}


/**
 * Valida limites de variação para inputs
 * @param {number} value - Valor a ser validado
 * @param {number} maxLimit - Limite máximo
 * @param {number} minLimit - Limite mínimo
 * @param {HTMLElement} input - Elemento input para atualizar
 * @param {string} inputName - Nome do input para mensagens
 * @returns {number} Valor validado e limitado
 */
function validateVariationLimits(value, maxLimit, minLimit, input, inputName = 'Valor') {
    let numValue = validateNumericInput(value);
    
    if (numValue > maxLimit) {
        input.value = maxLimit;
        numValue = maxLimit;
        showAlert(`${inputName} máximo permitido: +${maxLimit}%`, 'warning');
    } else if (numValue < minLimit) {
        input.value = minLimit;
        numValue = minLimit;
        showAlert(`${inputName} mínimo permitido: ${minLimit}%`, 'warning');
    }
    
    return numValue;
}

/**
 * Aplica classes visuais de positivo/negativo ao input
 * @param {HTMLElement} input - Elemento input
 * @param {number} value - Valor numérico
 */
function applyVisualClasses(input, value) {
    input.classList.remove('positive', 'negative');
    if (value > 0) {
        input.classList.add('positive');
    } else if (value < 0) {
        input.classList.add('negative');
    }
}

/**
 * Valida se um elemento DOM existe
 * @param {HTMLElement} element - Elemento a ser validado
 * @param {string} elementName - Nome do elemento para logs
 * @returns {boolean} true se existe, false caso contrário
 */
function validateElementExists(element, elementName = 'Elemento') {
    if (!element) {
        console.error(`${elementName} não encontrado`);
        return false;
    }
    return true;
}

/**
 * Valida e processa input de variação com limites padrão
 * @param {HTMLElement} input - Elemento input
 * @param {string} inputName - Nome do input
 * @param {number} maxLimit - Limite máximo (padrão: 10)
 * @param {number} minLimit - Limite mínimo (padrão: -10)
 * @returns {number} Valor validado
 */
function validateVariationInput(input, inputName = 'Valor', maxLimit = 10, minLimit = -10) {
    const value = validateVariationLimits(input.value, maxLimit, minLimit, input, inputName);
    applyVisualClasses(input, value);
    return value;
}

// ============================================================================
// CONFIGURAÇÕES E CONSTANTES - v2.3
// ============================================================================

// ============================================================================
// SISTEMA DE CORES PADRONIZADO v2.5 - CORRIGIDO
// Versão: 2024-01-15 - CORES CONSISTENTES IMPLEMENTADAS
// ============================================================================
const COLOR_SCHEME = {
    // Cores principais - SEMPRE consistentes
    BULLISH: '#22c55e',    // Verde - Movimentos de ALTA
    BEARISH: '#ef4444',    // Vermelho - Movimentos de BAIXA
    NEUTRAL: '#6b7280',    // Cinza - Neutro/Incompleto
    WARNING: '#f59e0b',    // Amarelo - Apenas para avisos
    
    // Cores com transparência para backgrounds
    BULLISH_BG: 'rgba(34, 197, 94, 0.15)',
    BEARISH_BG: 'rgba(239, 68, 68, 0.15)',
    NEUTRAL_BG: 'rgba(107, 114, 128, 0.15)',
    WARNING_BG: 'rgba(245, 158, 11, 0.15)',
    
    // Cores para bordas
    BULLISH_BORDER: 'rgba(34, 197, 94, 0.4)',
    BEARISH_BORDER: 'rgba(239, 68, 68, 0.4)',
    NEUTRAL_BORDER: 'rgba(107, 114, 128, 0.4)',
    WARNING_BORDER: 'rgba(245, 158, 11, 0.4)'
};

/**
 * Função helper para determinar cores baseadas na direção do movimento
 * @param {number} value - Valor do movimento (positivo = alta, negativo = baixa)
 * @param {string} type - Tipo de cor ('text', 'bg', 'border')
 * @returns {string} Cor apropriada
 */
function getMovementColor(value, type = 'text') {
    if (value === null || value === undefined || value === 0) {
        return type === 'text' ? COLOR_SCHEME.NEUTRAL : 
               type === 'bg' ? COLOR_SCHEME.NEUTRAL_BG : 
               COLOR_SCHEME.NEUTRAL_BORDER;
    }
    
    const isPositive = value > 0;
    return type === 'text' ? (isPositive ? COLOR_SCHEME.BULLISH : COLOR_SCHEME.BEARISH) :
           type === 'bg' ? (isPositive ? COLOR_SCHEME.BULLISH_BG : COLOR_SCHEME.BEARISH_BG) :
           (isPositive ? COLOR_SCHEME.BULLISH_BORDER : COLOR_SCHEME.BEARISH_BORDER);
}

const CONFIG = {
    // Limites de validação
    LIMITS: {
        VARIATION: {
            MAX: 10,
            MIN: -10
        },
        VIX_VARIATION: {
            MAX: 20,
            MIN: -20
        },
        VIX_ABSOLUTE: {
            MAX: 80,
            MIN: 5
        },
        MACRO: {
            MAX: 10,
            MIN: -10
        },
        VIX_MACRO: {
            MAX: 20,
            MIN: -20
        }
    },
    
    // Configurações de formatação
    FORMAT: {
        PERCENTAGE_DECIMALS: 4,
        PERCENTAGE_DISPLAY_DECIMALS: 3,
        CONTRIBUTION_DECIMALS: 4
    },
    
    // Configurações de sensibilidade
    SENSITIVITY: {
        DEFAULT: 1.0,
        MAX: 2.0,
        MIN: 0.1
    },
    
    // Configurações de peso
    WEIGHTS: {
        MACRO_DEFAULT: 30,
        VIX_DEFAULT: 20,
        ADR_DEFAULT: 50
    },
    
    // Configurações de confiabilidade
    RELIABILITY: {
        PRINCIPAL: 95,
        SECONDARY: 60,
        MACRO: 80,
        VIX: 85
    },
    
    // Configurações de liquidez
    LIQUIDITY: {
        HIGH: 1.0,
        MEDIUM: 0.8,
        LOW: 0.5
    },
    
    // Configurações de timeout
    TIMEOUTS: {
        VALIDATION_UPDATE: 10,
        CALCULATION_UPDATE: 100,
        SESSION_SAVE: 10
    },
    
    // Configurações de interface
    UI: {
        DEFAULT_CONTRIBUTION: '0,0000%',
        CALCULATING_STATUS: 'calculating',
        UNSAVED_STATUS: 'unsaved',
        
        // Mensagens de status padronizadas
        STATUS: {
            CALCULATING: '🔄 Calculando...',
            UNSAVED: '⚠️ Dados não salvos',
            SAVED: '✅ Dados salvos',
            ERROR: '❌ Erro nos dados',
            LOADING: '⏳ Carregando...',
            READY: '✅ Pronto'
        },
        
        // Mensagens de validação padronizadas
        VALIDATION: {
            CONFIRMED: '✅ Confirmado',
            WEAKENED: '⚠️ Enfraquecido',
            DIVERGED: '❌ Divergente',
            INCOMPLETE: '⏳ Incompleto',
            ONLY_AFTER: '📊 Apenas After',
            ONLY_CLOSING: '📈 Apenas Fechamento',
            ONLY_PRE: '🌅 Apenas Pré'
        },
        
        // Mensagens de confiabilidade padronizadas
        CONFIDENCE: {
            HIGH: 'Alta',
            MEDIUM: 'Média',
            LOW: 'Baixa',
            VERY_LOW: 'Muito Baixa'
        },
        
        // Mensagens de recomendação padronizadas
        RECOMMENDATION: {
            BUY: '🟢 COMPRA',
            SELL: '🔴 VENDA',
            NEUTRAL: '⚪ NEUTRO',
            CAUTION: '⚠️ CUIDADO',
            WAIT: '⏳ AGUARDAR'
        }
    }
};

// ============================================================================
// CACHE DE ELEMENTOS DOM - v2.3
// ============================================================================

const DOMCache = {
    // Elementos de configuração
    nightModeToggle: null,
    sensibilityRange: null,
    sensibilityValue: null,
    effectiveSensitivity: null,
    includeSecondary: null,
    macroWeight: null,
    macroWeightValue: null,
    vixWeight: null,
    vixWeightValue: null,
    autoAdjustVix: null,
    autoSave: null,
    
    // Elementos VIX
    vixVariation: null,
    vixAbsolute: null,
    vixRecommendation: null,
    vixAlerts: null,
    vixSensitivityInfo: null,
    vixStatus: null,
    
    // Elementos de interface
    nightToggleIcon: null,
    currentDateTime: null,
    footerTimestamp: null,
    
    // Tabelas
    adrsMainTable: null,
    adrsSecondaryTable: null,
    
    // Inicializar cache
    init() {
        this.nightModeToggle = document.getElementById('nightModeToggle');
        this.sensibilityRange = document.getElementById('sensibilityRange');
        this.sensibilityValue = document.getElementById('sensibilityValue');
        this.effectiveSensitivity = document.getElementById('effectiveSensitivity');
        this.includeSecondary = document.getElementById('includeSecondary');
        this.macroWeight = document.getElementById('macroWeight');
        this.macroWeightValue = document.getElementById('macroWeightValue');
        this.vixWeight = document.getElementById('vixWeight');
        this.vixWeightValue = document.getElementById('vixWeightValue');
        this.autoAdjustVix = document.getElementById('autoAdjustVix');
        this.autoSave = document.getElementById('autoSave');
        
        this.vixVariation = document.getElementById('vixVariation');
        this.vixAbsolute = document.getElementById('vixAbsolute');
        this.vixRecommendation = document.getElementById('vixRecommendation');
        this.vixAlerts = document.getElementById('vixAlerts');
        this.vixSensitivityInfo = document.getElementById('vixSensitivityInfo');
        this.vixStatus = document.getElementById('vixStatus');
        
        this.nightToggleIcon = document.getElementById('nightToggleIcon');
        this.currentDateTime = document.getElementById('currentDateTime');
        this.footerTimestamp = document.getElementById('footerTimestamp');
        
        this.adrsMainTable = document.getElementById('adrsMainTable');
        this.adrsSecondaryTable = document.getElementById('adrsSecondaryTable');
    },
    
    // Obter elemento com fallback
    getElement(id) {
        return document.getElementById(id);
    },
    
    // Obter elementos de ADR específico
    getADRInputs(ticker) {
        return {
            closing: document.getElementById(`closing-${ticker}`),
            after: document.getElementById(`after-${ticker}`),
            pre: document.getElementById(`pre-${ticker}`),
            checkbox: document.getElementById(`checkbox-${ticker}`),
            validation: document.getElementById(`validation-${ticker}`),
            contribution: document.getElementById(`contrib-${ticker}`)
        };
    }
};
const adrsData = {
    principais: [
        {
            ticker: "VALE",
            nome: "Vale S.A.",
            acao_b3: "VALE3",
            peso_ibovespa: 11.139,
            setor: "Mineração",
            liquidez: "Máxima",
            liquidez_weight: 1.0,
            volume_medio: 307.5
        },
        {
            ticker: "ITUB", 
            nome: "Itaú Unibanco",
            acao_b3: "ITUB4",
            peso_ibovespa: 8.212,
            setor: "Bancos",
            liquidez: "Alta",
            liquidez_weight: 0.9,
            volume_medio: 95.2
        },
        {
            ticker: "PBR",
            nome: "Petrobras PN", 
            acao_b3: "PETR4",
            peso_ibovespa: 6.264,
            setor: "Petróleo",
            liquidez: "Máxima",
            liquidez_weight: 1.0,
            volume_medio: 185.8
        },
        {
            ticker: "PBR-A",
            nome: "Petrobras ON",
            acao_b3: "PETR3", 
            peso_ibovespa: 4.037,
            setor: "Petróleo",
            liquidez: "Máxima",
            liquidez_weight: 1.0,
            volume_medio: 142.3
        },
        {
            ticker: "BBD",
            nome: "Bradesco PN",
            acao_b3: "BBDC4",
            peso_ibovespa: 4.087,
            setor: "Bancos",
            liquidez: "Boa",
            liquidez_weight: 0.8,
            volume_medio: 67.9
        },
        {
            ticker: "BBDO", 
            nome: "Bradesco ON",
            acao_b3: "BBDC3",
            peso_ibovespa: 1.002,
            setor: "Bancos",
            liquidez: "Boa",
            liquidez_weight: 0.8,
            volume_medio: 23.4
        }
    ],
    secundarios: [
        {
            ticker: "ABEV",
            nome: "Ambev",
            acao_b3: "ABEV3",
            peso_ibovespa: 2.431,
            setor: "Bebidas",
            liquidez: "Moderada",
            liquidez_weight: 0.5,
            volume_medio: 45.7
        },
        {
            ticker: "ERJ",
            nome: "Embraer",
            acao_b3: "EMBR3",
            peso_ibovespa: 2.794,
            setor: "Aeroespacial",
            liquidez: "Moderada",
            liquidez_weight: 0.5,
            volume_medio: 32.1
        }
    ]
};

// Indicadores Macro v2.4 - SOLUÇÃO 3: PESOS BALANCEADOS PARA CONFIRMAÇÃO
const indicadoresMacro = [
    {
        ticker: "EWZ_CLOSE",
        nome: "EWZ Fechamento Anterior",
        descricao: "Fechamento do ETF Brasil no dia anterior",
        peso_calculo: 2.5, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Direto"
    },
    {
        ticker: "ES=F",
        nome: "S&P 500 Futures",
        descricao: "Sentimento global de risco",
        peso_calculo: 1.5, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Correlacionado"
    },
    {
        ticker: "CL=F",
        nome: "Petróleo WTI",
        descricao: "Impacta Petrobras e commodities",
        peso_calculo: 1.0, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Setorial"
    },
    {
        ticker: "DXY",
        nome: "Índice Dólar (DXY)",
        descricao: "Força do dólar vs emergentes",
        peso_calculo: 1.5, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Inverso"
    },
    {
        ticker: "VIX",
        nome: "VIX (CBOE Volatility Index)",
        descricao: "Índice de volatilidade - Correlação inversa com índices",
        peso_calculo: 1.0, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Volatilidade"
    },
    // NOVOS INDICADORES v2.4
    {
        ticker: "GC=F",
        nome: "Ouro (Gold Futures)",
        descricao: "Safe haven - Aversão a risco global",
        peso_calculo: 1.0, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Inverso"
    },
    {
        ticker: "TIOC1",
        nome: "Iron Ore (Minério de Ferro)",
        descricao: "Impacta diretamente VALE3 e commodities brasileiras",
        peso_calculo: 1.5, // AUMENTADO: 10x maior para impacto moderado
        impacto: "Direto"
    }
];

// VIX Smart Sensitivity v2.3 (mantido)
const vixThresholds = {
    low_volatility: 15,
    normal_volatility: 25,
    high_volatility: 35
};

// METODOLOGIA PROFESSOR DEIVSON PIMENTEL - VIX Smart Sensitivity
const vixSensitivityLimits = {
    vix_under_15: 2.0,    // Ativos possivelmente caros - Sensibilidade máxima
    vix_15_25: 1.5,       // Zona neutra - Sensibilidade normal
    vix_25_35: 1.2,       // Zona de cautela - Sensibilidade moderada
    vix_over_35: 0.8      // Ativos baratos (medo instaurado) - Sensibilidade conservadora
};

// Regiões de preço dos ativos (Professor Deivson Pimentel)
const vixPriceRegions = {
    expensive: { min: 0, max: 15, label: "Ativos Possivelmente Caros", color: "🟢" },
    neutral: { min: 15, max: 30, label: "Zona Neutra", color: "🟡" },
    cheap: { min: 30, max: 60, label: "Ativos Baratos (Medo Instaurado)", color: "🔴" },
    extreme: { min: 60, max: 100, label: "Medo Extremo", color: "⚫" }
};

// Relevância por percentual (Professor Deivson Pimentel)
const vixRelevanceThreshold = 5.0; // +5% ou -5% = Grande relevância

// Análise de relevância VIX (Professor Deivson Pimentel)
function analyzeVixRelevance(vixVariation) {
    const absVariation = Math.abs(vixVariation);
    const isRelevant = absVariation >= vixRelevanceThreshold;
    
    let interpretation = "";
    let impact = "neutral";
    
    if (isRelevant) {
        if (vixVariation > 0) {
            interpretation = "VIX +5%+ = NEGATIVO para ativos de risco";
            impact = "negative";
        } else {
            interpretation = "VIX -5%+ = POSITIVO para ativos de risco";
            impact = "positive";
        }
    } else {
        interpretation = "VIX <5% = Baixa relevância (era Trump)";
        impact = "neutral";
    }
    
    return {
        isRelevant,
        interpretation,
        impact,
        variation: vixVariation,
        threshold: vixRelevanceThreshold
    };
}

// Regras de validação v2.3 (mantidas)
const validationRules = {
    confirmed: {
        same_direction: true,
        max_difference: 0.5,
        weight_after: 0.5,
        weight_pre: 0.5,
        icon: "✅",
        color: COLOR_SCHEME.BULLISH,
        status: CONFIG.UI.VALIDATION.CONFIRMED
    },
    weakened: {
        same_direction: true,
        max_difference: 2.0,
        weight_after: 0.4,
        weight_pre: 0.6,
        icon: "⚠️",
        color: COLOR_SCHEME.WARNING,
        status: CONFIG.UI.VALIDATION.WEAKENED
    },
    divergence: {
        same_direction: false,
        weight_after: 0.3,
        weight_pre: 0.7,
        icon: "🔴",
        color: COLOR_SCHEME.BEARISH,
        status: "Divergência Total"
    },
    only_after: {
        weight_after: 1.0,
        weight_pre: 0.0,
        icon: "📊",
        color: COLOR_SCHEME.NEUTRAL,
        status: "Apenas After-Market"
    },
    only_closing: {
        weight_after: 0.0,
        weight_pre: 0.0,
        weight_closing: 1.0,
        icon: "🕐",
        color: COLOR_SCHEME.NEUTRAL,
        status: "Apenas Fechamento"
    },
    only_pre: {
        weight_after: 0.0,
        weight_pre: 1.0,
        icon: "🔄",
        color: "#3b82f6",
        status: "Apenas Pré-Market"
    }
};

const thresholds = {
    interpretacao: {
        muito_positivo: 0.25,
        positivo: 0.1,
        neutro_pos: 0.05,
        neutro_neg: -0.05,
        negativo: -0.1,
        muito_negativo: -0.25
    },
    confiabilidade: {
        muito_alta: 90,
        alta: 80,
        boa: 65,
        regular: 50,
        baixa: 35
    }
};

// Estado da aplicação v2.3
let appState = {
    sensibilidade: 1.0,
    incluirSecundarios: true,
    pesoMacro: 25,
    pesoVix: 10, // atualizado de 15 para 10
    autoAdjustVix: true,
    modoAnalise: 'complete',
    autoSave: true,
    nightMode: false,
    vixData: {
        variation: null,
        absolute: null
    },
    effectiveSensitivity: 1.0,
    // Regime de Volatilidade Adaptativo v2.5
    volatilityRegime: 'normal', // 'low', 'normal', 'high', 'extreme', 'crisis'
    regimeMultiplier: 1.0,
    adrsVolatility: 1.0,
    // Timing Effect v2.5
    timingEffect: {
        multiplier: 1.0,
        confidence: 1.0,
        period: 'REGULAR_HOURS',
        recommendation: 'NORMAL'
    },
    // Mean Reversion v2.5
    meanReversion: {
        scores: {},
        summary: {
            totalADRs: 0,
            validADRs: 0,
            strongSignals: 0,
            moderateSignals: 0,
            weakSignals: 0
        }
    },
    // Information Ratio v2.5
    informationRatios: {
        ratios: {},
        summary: {
            totalADRs: 0,
            validADRs: 0,
            highQuality: 0,
            mediumQuality: 0,
            lowQuality: 0,
            avgIR: 0
        }
    },
    // Volatility Clustering v2.5
    volatilityClustering: {
        history: new Map(),
        duration: 0,
        isActive: false,
        intensity: 0,
        lastUpdate: Date.now(),
        recommendation: {
            signal: 'VOLATILIDADE_NORMAL',
            action: 'OPERAÇÃO_NORMAL',
            confidence: 'BAIXA',
            description: 'Nenhum clustering detectado.',
            multiplier: 1.0
        }
    }
};

// CORREÇÃO: Função para corrigir sensibilidade VIX
function correctVixSensitivity() {
    // Se VIX < 30 e auto-ajuste desativado, forçar sensibilidade 1.0
    if (!appState.autoAdjustVix && appState.vixData.absolute && appState.vixData.absolute < 30) {
        // console.log('🔧 VIX CORREÇÃO INICIAL: VIX < 30 + auto-ajuste desativado, forçando sensibilidade 1.0');
        appState.effectiveSensitivity = 1.0;
        appState.sensibilidade = 1.0;
        return true;
    }
    return false;
}

// Chave para localStorage v2.3
const STORAGE_KEY = 'adrCalculatorData_v2_3';

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    updateDateTime();
    setInterval(updateDateTime, 1000);
    // Delay para carregar sessão após DOM estar totalmente pronto
    setTimeout(() => {
        loadSession();
    }, 100);
});

function initializeApp() {
    // Inicializar cache de elementos DOM
    DOMCache.init();
    
    // Verificar se tem preferência de tema salva
    const savedTheme = localStorage.getItem('nightMode');
    if (savedTheme === 'true') {
        toggleNightMode(true, false);
    }
    
    createADRsTables();
    updateAllCalculations();
    updateFooterTimestamp();
    updateSessionStatus();
    
    // CORREÇÃO: Aplicar correção de sensibilidade VIX na inicialização
    correctVixSensitivity();
    
    updateVixInterface();
    
    // Inicializar indicadores de status
    updateDataStatus('saved');
    
    // Inicializar Market Sentiment Intelligence
    updateMarketSentiment();
    
}

function setupEventListeners() {
    setupNightModeListeners();
    setupVixListeners();
    setupConfigurationListeners();
    setupAnalysisModeListeners();
    setupAutoSaveListeners();
    setupMacroInputListeners();
    setupChangeDetection();
}

function setupNightModeListeners() {
    if (DOMCache.nightModeToggle) {
        DOMCache.nightModeToggle.removeEventListener('click', handleNightModeToggle);
        DOMCache.nightModeToggle.addEventListener('click', handleNightModeToggle);
    } else {
        console.error('Night mode toggle element not found');
    }
}

function setupVixListeners() {
    if (DOMCache.vixVariation) {
        DOMCache.vixVariation.addEventListener('input', function() {
            handleVixInput('variation', this.value);
        });
    }
    
    if (DOMCache.vixAbsolute) {
        DOMCache.vixAbsolute.addEventListener('input', function() {
            handleVixInput('absolute', this.value);
        });
    }
}

function setupConfigurationListeners() {
    setupSensibilityListener();
    setupIncludeSecondaryListener();
    setupWeightListeners();
    setupAutoAdjustVixListener();
}

function setupSensibilityListener() {
    if (DOMCache.sensibilityRange) {
        DOMCache.sensibilityRange.addEventListener('input', function() {
            let newSensitivity = parseFloat(this.value);
            
            // Aplicar limite VIX se ativo
            if (appState.autoAdjustVix && appState.vixData.absolute) {
                const vixLimit = getVixSensitivityLimit(appState.vixData.absolute);
                if (newSensitivity > vixLimit.maxSensitivity) {
                    newSensitivity = vixLimit.maxSensitivity;
                    this.value = newSensitivity;
                    showAlert(`Sensibilidade limitada pelo VIX: ${vixLimit.recommendation}`, 'warning');
                }
            }
            
            appState.sensibilidade = newSensitivity;
            appState.effectiveSensitivity = newSensitivity;
            if (DOMCache.sensibilityValue) {
                DOMCache.sensibilityValue.textContent = `${newSensitivity}x`;
            }
            if (DOMCache.effectiveSensitivity) {
                DOMCache.effectiveSensitivity.textContent = `${newSensitivity}x`;
            }
            
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    }
}

function setupIncludeSecondaryListener() {
    if (DOMCache.includeSecondary) {
        DOMCache.includeSecondary.addEventListener('change', function() {
            appState.incluirSecundarios = this.checked;
            toggleSecondarySection(this.checked);
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    }
}

function setupWeightListeners() {
    if (DOMCache.macroWeight) {
        DOMCache.macroWeight.addEventListener('input', function() {
            appState.pesoMacro = parseInt(this.value);
            if (DOMCache.macroWeightValue) {
                DOMCache.macroWeightValue.textContent = `${this.value}%`;
            }
            updateMacroWeights();
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    }

    if (DOMCache.vixWeight) {
        DOMCache.vixWeight.addEventListener('input', function() {
            appState.pesoVix = parseInt(this.value);
            if (DOMCache.vixWeightValue) {
                DOMCache.vixWeightValue.textContent = `${this.value}%`;
            }
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    }
}

function setupAutoAdjustVixListener() {
    if (DOMCache.autoAdjustVix) {
        // // console.log('✅ VIX: Listener do auto-ajuste configurado');
        DOMCache.autoAdjustVix.addEventListener('change', function() {
            // // console.log('🔄 VIX: Auto-ajuste alterado para:', this.checked);
            appState.autoAdjustVix = this.checked;
            
            // CORREÇÃO: Se desativar auto-ajuste e VIX < 30, forçar sensibilidade 1.0
            if (!this.checked && appState.vixData.absolute && appState.vixData.absolute < 30) {
                // console.log('🔧 VIX CORREÇÃO: Auto-ajuste desativado + VIX < 30, forçando sensibilidade 1.0');
                appState.effectiveSensitivity = 1.0;
                appState.sensibilidade = 1.0;
                
                // Atualizar interface
                const sensibilityRange = document.getElementById('sensibilityRange');
                const sensibilityValue = document.getElementById('sensibilityValue');
                const effectiveSensitivityElement = document.getElementById('effectiveSensitivity');
                
                if (sensibilityRange) sensibilityRange.value = 1.0;
                if (sensibilityValue) sensibilityValue.textContent = '1.0x';
                if (effectiveSensitivityElement) effectiveSensitivityElement.textContent = '1.0x';
            }
            
            updateVixInterface();
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    } else {
        // console.log('❌ VIX: Elemento autoAdjustVix não encontrado!');
    }
}

function setupAnalysisModeListeners() {
    document.querySelectorAll('input[name="analysisMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            appState.modoAnalise = this.value;
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    });
}

function setupAutoSaveListeners() {
    if (DOMCache.autoSave) {
        DOMCache.autoSave.addEventListener('change', function() {
            appState.autoSave = this.checked;
            if (this.checked) {
                saveSession();
                showAlert('Auto-save ativado. Dados serão salvos automaticamente.', 'success');
            }
        });
    }
}

function setupMacroInputListeners() {
    document.querySelectorAll('.macro-input').forEach(input => {
        input.addEventListener('input', function() {
            handleMacroInput(this);
            updateAllCalculations();
            if (appState.autoSave) saveSession();
        });
    });
}

// FIXED Night Mode Handler
function handleNightModeToggle(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleNightMode();
}

// VIX Smart Functions v2.3 (mantidas)
function handleVixInput(type, value) {
    const numValue = validateNumericInput(value, null);
    
    if (type === 'variation') {
        if (validateElementExists(DOMCache.vixVariation, 'VIX Variation Input')) {
            const validatedValue = validateVariationLimits(value, CONFIG.LIMITS.VIX_VARIATION.MAX, CONFIG.LIMITS.VIX_VARIATION.MIN, DOMCache.vixVariation, 'Variação VIX');
            appState.vixData.variation = validatedValue;
        }
    } else if (type === 'absolute') {
        if (validateElementExists(DOMCache.vixAbsolute, 'VIX Absolute Input')) {
            const validatedValue = validateVariationLimits(value, CONFIG.LIMITS.VIX_ABSOLUTE.MAX, CONFIG.LIMITS.VIX_ABSOLUTE.MIN, DOMCache.vixAbsolute, 'VIX Absoluto');
            appState.vixData.absolute = validatedValue;
        }
    }
    
    updateVixInterface();
    debounceUpdate();
    if (appState.autoSave) saveSession();
}

// METODOLOGIA PROFESSOR DEIVSON PIMENTEL - VIX Smart Sensitivity
function getVixSensitivityLimit(vixLevel) {
    let maxSensitivity = 2.0;
    let recommendation = "neutro";
    let status = "normal";
    let region = "neutral";
    
    // Determinar região de preço dos ativos (Professor Deivson Pimentel)
    if (vixLevel < 15) {
        region = "expensive";
        maxSensitivity = vixSensitivityLimits.vix_under_15;
        recommendation = "Ativos possivelmente caros - Sensibilidade máxima permitida";
        status = "low";
    } else if (vixLevel >= 15 && vixLevel < 30) {
        region = "neutral";
        maxSensitivity = vixSensitivityLimits.vix_15_25;
        recommendation = "Zona neutra - Modo padrão";
        status = "normal";
    } else if (vixLevel >= 30 && vixLevel < 60) {
        region = "cheap";
        maxSensitivity = vixSensitivityLimits.vix_25_35;
        recommendation = "Ativos baratos (medo instaurado) - Modo conservador ativado";
        status = "high";
    } else if (vixLevel >= 60) {
        region = "extreme";
        maxSensitivity = vixSensitivityLimits.vix_over_35;
        recommendation = "Medo extremo - Modo ultra conservador";
        status = "extreme";
    }
    
    return { 
        maxSensitivity, 
        recommendation, 
        status, 
        region,
        regionInfo: vixPriceRegions[region]
    };
}

function updateVixInterface() {
    // DEBUG: Log completo do VIX - REMOVIDO PARA PERFORMANCE
    
    // CORREÇÃO: Forçar sensibilidade para 1.0 se VIX < 30 e auto-ajuste desativado
    if (!appState.autoAdjustVix && appState.vixData.absolute && appState.vixData.absolute < 30) {
        // // console.log('🔧 VIX CORREÇÃO: Forçando sensibilidade para 1.0 (VIX < 30, auto-ajuste desativado)');
        appState.effectiveSensitivity = 1.0;
        appState.sensibilidade = 1.0;
        
        // Atualizar interface
        const sensibilityRange = document.getElementById('sensibilityRange');
        const sensibilityValue = document.getElementById('sensibilityValue');
        const effectiveSensitivityElement = document.getElementById('effectiveSensitivity');
        
        if (sensibilityRange) sensibilityRange.value = 1.0;
        if (sensibilityValue) sensibilityValue.textContent = '1.0x';
        if (effectiveSensitivityElement) effectiveSensitivityElement.textContent = '1.0x';
    }
    
    const vixRecommendation = document.getElementById('vixRecommendation');
    const vixAlerts = document.getElementById('vixAlerts');
    const vixSensitivityInfo = document.getElementById('vixSensitivityInfo');
    const vixStatus = document.getElementById('vixStatus');
    
    if (!vixRecommendation || !vixAlerts) return;
    
    // Limpar alertas anteriores
    vixAlerts.innerHTML = '';
    
    if (!appState.vixData.absolute) {
        // Estado inicial
        vixRecommendation.className = 'vix-recommendation';
        vixRecommendation.innerHTML = `
            <div class="vix-rec-icon">🟡</div>
            <div class="vix-rec-text">
                <h4>Aguardando dados VIX</h4>
                <p>Insira os valores do VIX para ativação do ajuste automático</p>
            </div>
        `;
        
        if (vixStatus) vixStatus.textContent = 'Neutro';
        if (vixSensitivityInfo) {
            vixSensitivityInfo.innerHTML = '<small>Limite dinâmico baseado no VIX será aplicado automaticamente</small>';
        }
        return;
    }
    
    const vixLimit = getVixSensitivityLimit(appState.vixData.absolute);
    const vixRelevance = analyzeVixRelevance(appState.vixData.variation);
    const statusClass = `vix-recommendation--${vixLimit.status}`;
    
    vixRecommendation.className = `vix-recommendation ${statusClass}`;
    
    // Usar cores da metodologia do Professor Deivson
    let icon = vixLimit.regionInfo.color;
    let regionLabel = vixLimit.regionInfo.label;
    
    vixRecommendation.innerHTML = `
        <div class="vix-rec-icon">${icon}</div>
        <div class="vix-rec-text">
            <h4>VIX ${appState.vixData.absolute.toFixed(1)} - ${regionLabel}</h4>
            <p><strong>Metodologia Prof. Deivson:</strong> ${vixLimit.recommendation}</p>
            <p><strong>Relevância:</strong> ${vixRelevance.interpretation}</p>
        </div>
    `;
    
    // Atualizar status no resumo
    if (vixStatus) {
        vixStatus.textContent = vixLimit.status.charAt(0).toUpperCase() + vixLimit.status.slice(1);
    }
    
    // Atualizar info de sensibilidade (Metodologia Professor Deivson)
    if (vixSensitivityInfo) {
        vixSensitivityInfo.innerHTML = `
            <small>
                <strong>VIX Smart Sensitivity:</strong> máximo ${vixLimit.maxSensitivity}x<br>
                <strong>Região:</strong> ${regionLabel}<br>
                <strong>Relevância:</strong> ${vixRelevance.isRelevant ? 'ALTA' : 'BAIXA'} (${vixRelevance.variation.toFixed(1)}%)
            </small>
        `;
    }
    
    // Alertas específicos (Metodologia Professor Deivson)
    if (appState.vixData.absolute > 30) {
        const alert = document.createElement('div');
        alert.className = 'alert alert--vix-panic';
        alert.innerHTML = `🔴 ATIVOS BARATOS (MEDO INSTAURADO) - VIX ${appState.vixData.absolute.toFixed(1)} - Sensibilidade conservadora ativada`;
        vixAlerts.appendChild(alert);
    }
    
    if (appState.vixData.absolute < 15) {
        const alert = document.createElement('div');
        alert.className = 'alert alert--vix-calm';
        alert.innerHTML = `🟢 ATIVOS POSSIVELMENTE CAROS - VIX ${appState.vixData.absolute.toFixed(1)} - Sensibilidade máxima permitida`;
        vixAlerts.appendChild(alert);
    }
    
    if (vixRelevance.isRelevant) {
        const alert = document.createElement('div');
        alert.className = `alert alert--vix-relevance-${vixRelevance.impact}`;
        alert.innerHTML = `📊 RELEVÂNCIA ALTA - ${vixRelevance.interpretation}`;
        vixAlerts.appendChild(alert);
    }
    
    if (appState.vixData.absolute < 15) {
        const alert = document.createElement('div');
        alert.className = 'alert alert--vix-complacency';
        alert.innerHTML = '⚠️ ZONA DE COMPLACÊNCIA - Cuidado com reversões súbitas';
        vixAlerts.appendChild(alert);
    }
    
    // Interpretar VIX vs ADRs se tivermos dados
    const vixInterpretation = getVixInterpretation();
    if (vixInterpretation) {
        const alert = document.createElement('div');
        alert.className = `alert alert--${vixInterpretation.type}`;
        alert.innerHTML = vixInterpretation.message;
        vixAlerts.appendChild(alert);
    }
    
    // Aplicar limite automático se ativo
    if (appState.autoAdjustVix) {
        console.log('🔍 VIX AUTO-AJUSTE ATIVO:', {
            vixLimit: vixLimit,
            sensibilidadeAtual: appState.sensibilidade,
            limitarSensibilidade: appState.sensibilidade > vixLimit.maxSensitivity
        });
        
        const sensibilityRange = document.getElementById('sensibilityRange');
        if (sensibilityRange && appState.sensibilidade > vixLimit.maxSensitivity) {
            console.log(`⚠️ VIX: Limitando sensibilidade de ${appState.sensibilidade} para ${vixLimit.maxSensitivity}`);
            
            appState.sensibilidade = vixLimit.maxSensitivity;
            appState.effectiveSensitivity = vixLimit.maxSensitivity;
            sensibilityRange.value = vixLimit.maxSensitivity;
            document.getElementById('sensibilityValue').textContent = `${vixLimit.maxSensitivity}x`;
            const effectiveSensitivityElement = document.getElementById('effectiveSensitivity');
            if (effectiveSensitivityElement) {
                effectiveSensitivityElement.textContent = `${vixLimit.maxSensitivity}x`;
            }
        } else {
            // console.log('✅ VIX: Sensibilidade dentro do limite permitido');
        }
    } else {
        // console.log('⚠️ VIX: Auto-ajuste DESATIVADO');
    }
}

function getVixInterpretation() {
    if (!appState.vixData.absolute || !appState.vixData.variation) return null;
    
    const vixLevel = appState.vixData.absolute;
    const vixChange = appState.vixData.variation;
    
    // Verificar se temos dados ADRs para comparar
    const adrsSignal = calculateADRsSignal();
    
    if (vixLevel > 30 && vixChange > 5) {
        return {
            type: 'error',
            message: '🔴 VOLATILIDADE EXTREMA - Mercado em pânico, movimentos exagerados esperados'
        };
    } else if (vixLevel < 15 && vixChange < -3) {
        return {
            type: 'warning',
            message: '⚠️ ZONA DE COMPLACÊNCIA - Mercado calmo demais, atenção para reversões'
        };
    } else if (vixLevel > 25 && adrsSignal > 0.1) {
        return {
            type: 'warning',
            message: '⚠️ DIVERGÊNCIA - VIX alto com ADRs positivos, cuidado com armadilhas'
        };
    } else if (vixLevel < 20 && adrsSignal < -0.1) {
        return {
            type: 'info',
            message: '📊 VIX baixo com ADRs negativos - Possível oversold ou deterioração'
        };
    }
    
    return null;
}

function calculateADRsSignal() {
    let totalSignal = 0;
    let count = 0;
    
    [...adrsData.principais, ...adrsData.secundarios].forEach(adr => {
        const afterInput = document.getElementById(`after-${adr.ticker}`);
        const preInput = document.getElementById(`pre-${adr.ticker}`);
        
        if (afterInput && preInput) {
            const afterValue = parseFloat(afterInput.value) || 0;
            const preValue = parseFloat(preInput.value) || 0;
            
            if (afterValue !== 0 || preValue !== 0) {
                const avgValue = (afterValue + preValue) / 2;
                totalSignal += avgValue * (adr.peso_ibovespa / 100);
                count++;
            }
        }
    });
    
    return count > 0 ? totalSignal / count : 0;
}

// Night Mode Functions - FIXED
function toggleNightMode(force = null, save = true) {
    
    const body = document.body;
    const icon = DOMCache.nightToggleIcon;
    const text = document.querySelector('.night-toggle-text');
    
    if (force !== null) {
        appState.nightMode = force;
    } else {
        appState.nightMode = !appState.nightMode;
    }
    
    
    if (appState.nightMode) {
        body.classList.add('night-mode');
        if (icon) icon.textContent = '☀️';
        if (text) text.textContent = 'Day Mode';
    } else {
        body.classList.remove('night-mode');
        if (icon) icon.textContent = '🌙';
        if (text) text.textContent = 'Night Mode';
    }
    
    if (save) {
        localStorage.setItem('nightMode', appState.nightMode.toString());
        if (appState.autoSave) saveSession();
    }
}

function updateDateTime() {
    const now = new Date();
    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'America/Sao_Paulo'
    };
    
    const formatted = now.toLocaleDateString('pt-BR', options);
    const dateTimeElement = DOMCache.currentDateTime;
    if (dateTimeElement) {
        dateTimeElement.textContent = formatted;
    }
}

function updateFooterTimestamp() {
    const now = new Date();
    const timestamp = now.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const footerElement = DOMCache.footerTimestamp;
    if (footerElement) {
        footerElement.textContent = `Última atualização: ${timestamp}`;
    }
}

function createADRsTables() {
    createMainADRsTable();
    createSecondaryADRsTable();
}

function createMainADRsTable() {
    if (!DOMCache.adrsMainTable) return;
    
    DOMCache.adrsMainTable.innerHTML = '';
    
    adrsData.principais.forEach(adr => {
        const row = createADRTableRow(adr, 'main');
        DOMCache.adrsMainTable.appendChild(row);
    });
}

function createSecondaryADRsTable() {
    if (!DOMCache.adrsSecondaryTable) return;
    
    DOMCache.adrsSecondaryTable.innerHTML = '';
    
    adrsData.secundarios.forEach(adr => {
        const row = createADRTableRow(adr, 'secondary');
        DOMCache.adrsSecondaryTable.appendChild(row);
    });
}

function createADRTableRow(adr, type) {
    const row = document.createElement('tr');
    
    const liquidezClass = `liquidez-badge--${adr.liquidez.toLowerCase().replace('á', 'a')}`;
    const pesoOriginal = adr.peso_ibovespa;
    const pesoAjustado = type === 'secondary' ? pesoOriginal * adr.liquidez_weight : pesoOriginal;
    
    row.innerHTML = buildADRRowHTML(adr, type, liquidezClass, pesoOriginal, pesoAjustado);
    
    // Event listeners
    setTimeout(() => {
        setupADRRowEventListeners(adr, type);
    }, CONFIG.TIMEOUTS.VALIDATION_UPDATE);
    
    return row;
}

function buildADRRowHTML(adr, type, liquidezClass, pesoOriginal, pesoAjustado) {
    return `
        <td class="ticker-cell">${adr.ticker}</td>
        <td>${adr.nome}</td>
        <td class="peso-cell">
            ${adr.acao_b3} (${formatPercentage(pesoOriginal, CONFIG.FORMAT.PERCENTAGE_DISPLAY_DECIMALS)}%)
            ${type === 'secondary' ? `<br><small>Ajust: ${formatPercentage(pesoAjustado, CONFIG.FORMAT.PERCENTAGE_DISPLAY_DECIMALS)}%</small>` : ''}
        </td>
        <td>
            <span class="liquidez-badge ${liquidezClass}">${adr.liquidez}</span>
        </td>
        <td class="closing-cell">
            <input 
                type="number" 
                step="0.01" 
                min="-10" 
                max="10" 
                class="variation-input closing-input" 
                id="closing-${adr.ticker}"
                placeholder="0,00"
                data-type="${type}"
            />
        </td>
        <td class="after-market-cell">
            <input 
                type="number" 
                step="0.01" 
                min="-10" 
                max="10" 
                class="variation-input after-market-input" 
                id="after-${adr.ticker}"
                placeholder="0,00"
                data-type="${type}"
            />
        </td>
        <td class="pre-market-cell">
            <input 
                type="number" 
                step="0.01" 
                min="-10" 
                max="10" 
                class="variation-input pre-market-input" 
                id="pre-${adr.ticker}"
                placeholder="0,00"
                data-type="${type}"
            />
        </td>
        <td class="validation-cell" id="validation-${adr.ticker}">
            <div class="validation-status validation-status--incomplete">
                <div class="validation-icon">⚪</div>
                <div class="validation-text">Sem Dados</div>
            </div>
        </td>
        <td class="final-contribution-cell" id="contrib-${adr.ticker}">${CONFIG.UI.DEFAULT_CONTRIBUTION}</td>
        <td>
            <input 
                type="checkbox" 
                class="checkbox-input" 
                id="checkbox-${adr.ticker}"
                data-type="${type}"
            />
        </td>
    `;
}

function setupADRRowEventListeners(adr, type) {
    const inputs = DOMCache.getADRInputs(adr.ticker);
    
    if (inputs.closing) {
        inputs.closing.addEventListener('input', function() {
            handleVariationInput(adr.ticker, 'closing', this.value, type);
        });
    }
    
    if (inputs.after) {
        inputs.after.addEventListener('input', function() {
            handleVariationInput(adr.ticker, 'after', this.value, type);
        });
    }
    
    if (inputs.pre) {
        inputs.pre.addEventListener('input', function() {
            handleVariationInput(adr.ticker, 'pre', this.value, type);
        });
    }
    
    if (inputs.checkbox) {
        inputs.checkbox.addEventListener('change', function() {
            handleCheckboxChange(adr.ticker, this.checked, type);
        });
    }
}

function handleVariationInput(ticker, marketType, value, type) {
    const input = document.getElementById(`${marketType}-${ticker}`);
    if (!validateElementExists(input, `Input ${marketType}-${ticker}`)) return;
    
    // Usar função utilitária para validação
    const numValue = validateVariationInput(input, `Variação ${marketType}`, CONFIG.LIMITS.VARIATION.MAX, CONFIG.LIMITS.VARIATION.MIN);
    
    // Atualizar validação e cálculos
    setTimeout(() => {
        updateValidationStatus(ticker);
        debounceUpdate();
        if (appState.autoSave) saveSession();
    }, CONFIG.TIMEOUTS.VALIDATION_UPDATE);
}

function handleCheckboxChange(ticker, isChecked, type) {
    const closingInput = document.getElementById(`closing-${ticker}`);
    const afterInput = document.getElementById(`after-${ticker}`);
    const preInput = document.getElementById(`pre-${ticker}`);
    const row = closingInput?.closest('tr');
    
    if (closingInput && afterInput && preInput) {
        closingInput.disabled = isChecked;
        afterInput.disabled = isChecked;
        preInput.disabled = isChecked;
        
        if (row) {
            row.classList.toggle('disabled-row', isChecked);
        }
        
        if (isChecked) {
            closingInput.value = '';
            afterInput.value = '';
            preInput.value = '';
            closingInput.classList.remove('positive', 'negative');
            afterInput.classList.remove('positive', 'negative');
            preInput.classList.remove('positive', 'negative');
        }
        
        updateValidationStatus(ticker);
        debounceUpdate();
        if (appState.autoSave) saveSession();
    }
}

function updateValidationStatus(ticker) {
    const closingInput = document.getElementById(`closing-${ticker}`);
    const afterInput = document.getElementById(`after-${ticker}`);
    const preInput = document.getElementById(`pre-${ticker}`);
    const validationCell = document.getElementById(`validation-${ticker}`);
    const checkbox = document.getElementById(`checkbox-${ticker}`);
    
    if (!closingInput || !afterInput || !preInput || !validationCell || !checkbox) return;
    
    // Se desabilitado, mostrar como sem dados
    if (checkbox.checked) {
        validationCell.innerHTML = `
            <div class="validation-status validation-status--incomplete">
                <div class="validation-icon">⚪</div>
                <div class="validation-text">Desabilitado</div>
            </div>
        `;
        return;
    }
    
    // Tentar usar nova lógica matemática primeiro
    const spreadAnalysis = calculateRealSpreadAnalysis(ticker, getRealClosingPrice(ticker), 
        parseFloat(afterInput.value) || 0, parseFloat(preInput.value) || 0);
    
    if (spreadAnalysis) {
        const validation = determineAdvancedValidationType(spreadAnalysis);
        updateValidationDisplay(ticker, validation);
        return;
    }
    
    // Fallback para lógica original
    const closingValue = validateNumericInput(closingInput.value, null);
    const afterValue = validateNumericInput(afterInput.value, null);
    const preValue = validateNumericInput(preInput.value, null);
    
    let validationType = determineValidationType(afterValue, closingValue, preValue);
    let rule = validationRules[validationType];
    
    validationCell.innerHTML = `
        <div class="validation-status validation-status--${validationType.replace('_', '-')}" 
             data-tooltip="${rule.status}">
            <div class="validation-icon">${rule.icon}</div>
            <div class="validation-text">${rule.status.split(' ')[0]}</div>
        </div>
    `;
}

function determineValidationType(afterValue, closingValue, preValue) {
    // Sem dados
    if (afterValue === null && closingValue === null && preValue === null) {
        return 'incomplete';
    }
    
    // Zero é considerado null para fins de validação
    if (afterValue === 0) afterValue = null;
    if (closingValue === 0) closingValue = null;
    if (preValue === 0) preValue = null;
    
    // Apenas after-market
    if (afterValue !== null && closingValue === null && preValue === null) {
        return 'only_after';
    }
    
    // Apenas fechamento
    if (afterValue === null && closingValue !== null && preValue === null) {
        return 'only_closing';
    }
    
    // Apenas pré-market
    if (afterValue === null && closingValue === null && preValue !== null) {
        return 'only_pre';
    }
    
    // After + Fechamento
    if (afterValue !== null && closingValue !== null && preValue === null) {
        const sameDirection = (afterValue >= 0 && closingValue >= 0) || (afterValue <= 0 && closingValue <= 0);
        const difference = Math.abs(afterValue - closingValue);
        
        if (!sameDirection) {
            return 'divergence';
        }
        
        if (sameDirection && difference <= 0.5) {
            return 'confirmed';
        }
        
        if (sameDirection && difference > 0.5) {
            return 'weakened';
        }
    }
    
    // Fechamento + Pré
    if (afterValue === null && closingValue !== null && preValue !== null) {
        const sameDirection = (closingValue >= 0 && preValue >= 0) || (closingValue <= 0 && preValue <= 0);
        const difference = Math.abs(closingValue - preValue);
        
        if (!sameDirection) {
            return 'divergence';
        }
        
        if (sameDirection && difference <= 0.5) {
            return 'confirmed';
        }
        
        if (sameDirection && difference > 0.5) {
            return 'weakened';
        }
    }
    
    // After + Pré (sem fechamento)
    if (afterValue !== null && closingValue === null && preValue !== null) {
        const sameDirection = (afterValue >= 0 && preValue >= 0) || (afterValue <= 0 && preValue <= 0);
        const difference = Math.abs(afterValue - preValue);
        
        if (!sameDirection) {
            return 'divergence';
        }
        
        if (sameDirection && difference <= 0.5) {
            return 'confirmed';
        }
        
        if (sameDirection && difference > 0.5) {
            return 'weakened';
        }
    }
    
    // Todos os três disponíveis
    if (afterValue !== null && closingValue !== null && preValue !== null) {
        const afterClosingSame = (afterValue >= 0 && closingValue >= 0) || (afterValue <= 0 && closingValue <= 0);
        const closingPreSame = (closingValue >= 0 && preValue >= 0) || (closingValue <= 0 && preValue <= 0);
        
        if (afterClosingSame && closingPreSame) {
            const maxDiff = Math.max(
                Math.abs(afterValue - closingValue),
                Math.abs(closingValue - preValue),
                Math.abs(afterValue - preValue)
            );
            
            if (maxDiff <= 0.5) {
                return 'confirmed';
            } else if (maxDiff <= 1.0) {
                return 'weakened';
            } else {
                return 'divergence';
            }
        } else {
            return 'divergence';
        }
    }
    
    return 'incomplete';
}

function calculateValidatedContribution(ticker, afterValue, closingValue, preValue, pesoEfetivo) {
    // VALIDAÇÃO PRÉVIA
    const validation = validateInputData(ticker, afterValue, closingValue, preValue);
    
    if (!validation.isValid) {
        console.error(`❌ Dados inválidos para ${ticker}:`, validation.errors);
        return 0; // Retornar 0 para dados inválidos
    }
    
    if (validation.warnings.length > 0) {
        // console.warn(`⚠️ Avisos para ${ticker}:`, validation.warnings);
    }
    
    // LÓGICA UNIFICADA: Usar análise matemática de divergências
    const spreadAnalysis = calculateRealSpreadAnalysis(ticker, getRealClosingPrice(ticker), afterValue, preValue);
    
    if (!spreadAnalysis) {
        // FALLBACK: Calcular saldo remanescente manualmente
        let finalValue = 0;
        
        // Calcular movimento total acumulado
        if (preValue !== null) {
            finalValue = preValue; // Pré-market já inclui todo o movimento
        } else if (afterValue !== null) {
            finalValue = afterValue; // After-market inclui movimento até ali
        } else {
            finalValue = closingValue || 0; // Apenas fechamento
        }
        
        const contribuicao = (finalValue * pesoEfetivo * appState.effectiveSensitivity) / 100;
        
        updateValidationStatus(ticker);
        return contribuicao;
    }
    
    // Determinar tipo de validação usando nova lógica matemática
    const advancedValidation = determineAdvancedValidationType(spreadAnalysis);
    
    // CALCULAR SALDO REMANESCENTE (não anular dados)
    let finalValue = 0;
    
    // Sempre usar o spread total (fechamento → pré) como saldo remanescente
    finalValue = spreadAnalysis.preSpread || 0;
    
    // Aplicar peso efetivo e sensibilidade
    const contribuicao = (finalValue * pesoEfetivo * appState.effectiveSensitivity) / 100;
    
    // Atualizar interface com nova validação
    updateValidationDisplay(ticker, advancedValidation);
    
    return contribuicao;
}

function handleMacroInput(input) {
    // VIX tem limite diferente
    const isVix = input.id === 'macro-VIX';
    const maxLimit = isVix ? CONFIG.LIMITS.VIX_MACRO.MAX : CONFIG.LIMITS.MACRO.MAX;
    const minLimit = isVix ? CONFIG.LIMITS.VIX_MACRO.MIN : CONFIG.LIMITS.MACRO.MIN;
    const inputName = isVix ? 'VIX' : 'Macro';
    
    // Usar função utilitária para validação
    validateVariationInput(input, inputName, maxLimit, minLimit);
}

function updateAllCalculations() {
    updateDataStatus('calculating'); // Mostrar "Calculando..."
    
    const calcs = calculateAdvancedMetrics();
    updateContributions(calcs);
    updateBreakdown(calcs);
    updateSummaryMetrics(calcs);
    updateValidationSummary(calcs);
    updateInterpretation(calcs);
    updateConfidence(calcs.confiabilidade);
    
    // Atualizar Market Sentiment Intelligence
    updateMarketSentiment();
    
    // Atualizar análise de spread detalhada
    updateSpreadAnalysis();
    
    // Atualizar interface do regime de volatilidade
    updateVolatilityRegimeInterface();
    
    
    // Atualizar projeção WINFUT
    if (winfutProjectionService && calcs && typeof calcs.saldoTotal === 'number' && typeof calcs.confiabilidade === 'number') {
        winfutProjectionService.updateCalculatorVariation(
            calcs.saldoTotal, 
            calcs.confiabilidade
        );
    }
    
    // Atualizar projeção WINFUT avançada (NOVO - FASE 1)
    if (calcs && typeof calcs.saldoTotal === 'number' && typeof calcs.confiabilidade === 'number') {
        try {
            console.log('🔄 Chamando updateAdvancedWinfutProjection com:', {
                saldo: calcs.saldoTotal,
                confianca: calcs.confiabilidade
            });
            const result = updateAdvancedWinfutProjection(calcs.saldoTotal, calcs.confiabilidade);
            if (!result) {
                // Limpar interface se não há dados válidos
                const container = document.getElementById('winfut-regions-container');
                if (container) {
                    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c757d; font-size: 14px;">Digite o fechamento WINFUT para ver as regiões de projeção</div>';
                }
            }
        } catch (error) {
            console.warn('⚠️ Erro na projeção WINFUT avançada:', error);
        }
    } else {
        console.log('⚠️ Condições não atendidas para WINFUT avançado:', {
            calcs: !!calcs,
            saldoTotal: calcs?.saldoTotal,
            confiabilidade: calcs?.confiabilidade
        });
    }
    
    // Adicionar evento para atualizar regiões quando WINFUT for digitado
    const winfutInput = document.getElementById('winfut-closing-price');
    if (winfutInput && !winfutInput.hasAttribute('data-events-added')) {
        winfutInput.addEventListener('input', function() {
            console.log('📝 WINFUT digitado:', this.value);
            // Atualizar regiões após um pequeno delay
            setTimeout(() => {
                if (calcs && typeof calcs.saldoTotal === 'number' && typeof calcs.confiabilidade === 'number') {
                    updateAdvancedWinfutProjection(calcs.saldoTotal, calcs.confiabilidade);
                }
            }, 500);
        });
        winfutInput.setAttribute('data-events-added', 'true');
    }
    
    // Após cálculos completos, mostrar "Dados Não Salvos" se não estiver em auto-save
    setTimeout(() => {
        if (!appState.autoSave) {
            updateDataStatus('unsaved');
        }
    }, 100);
}

function calculateAdvancedMetrics() {
    // Gerar chave de cache baseada nos dados atuais
    const cacheKey = generateCacheKey();
    
    // Tentar usar cache se disponível
    return getCachedCalculation(cacheKey, () => {
        const resultados = {
            principais: { contribuicao: 0, peso: 0, count: 0, confiabilidade: CONFIG.RELIABILITY.PRINCIPAL },
            secundarios: { contribuicao: 0, peso: 0, count: 0, confiabilidade: CONFIG.RELIABILITY.SECONDARY },
            macro: { contribuicao: 0, peso: 0, count: 0, confiabilidade: CONFIG.RELIABILITY.MACRO },
            vix: { contribuicao: 0, peso: 0, confiabilidade: CONFIG.RELIABILITY.VIX },
            validationStats: { confirmed: 0, weakened: 0, diverged: 0, incomplete: 0, only_after: 0, only_closing: 0, only_pre: 0 }
        };
    
    // Calcular ADRs principais
    adrsData.principais.forEach(adr => {
        const closingInput = document.getElementById(`closing-${adr.ticker}`);
        const afterInput = document.getElementById(`after-${adr.ticker}`);
        const preInput = document.getElementById(`pre-${adr.ticker}`);
        const checkbox = document.getElementById(`checkbox-${adr.ticker}`);
        
        if (closingInput && afterInput && preInput && checkbox && !checkbox.checked) {
            const closingValue = validateNumericInput(closingInput.value);
            const afterValue = validateNumericInput(afterInput.value);
            const preValue = validateNumericInput(preInput.value);
            
            // Contar se tem dados válidos (não null - inclui valores negativos)
            const hasAfterData = afterValue !== null;
            const hasClosingData = closingValue !== null;
            const hasPreData = preValue !== null;
            
            if (hasAfterData || hasClosingData || hasPreData) {
                // Peso base (original + liquidez)
                const pesoBase = adr.peso_ibovespa * adr.liquidez_weight;
                
                // Aplicar Information Ratio (INTEGRAÇÃO CUIDADOSA v2.5)
                const irData = appState.informationRatios?.ratios?.[adr.ticker];
                const irWeight = irData ? irData.dynamicWeight : 1.0; // Fallback seguro
                
                // Peso final com Information Ratio (SISTEMA SIMPLES)
                const pesoEfetivo = pesoBase * irWeight;
                
                console.log(`📊 Peso ${adr.ticker}: Base ${pesoBase.toFixed(2)} × IR ${irWeight.toFixed(2)} = ${pesoEfetivo.toFixed(2)}`);
                
                const contribuicao = calculateValidatedContribution(adr.ticker, afterValue, closingValue, preValue, pesoEfetivo);
                
                resultados.principais.contribuicao += contribuicao;
                resultados.principais.peso += pesoEfetivo;
                resultados.principais.count++;
                
                // Atualizar stats de validação
                const validationType = determineValidationType(afterValue, closingValue, preValue);
                updateValidationStats(resultados.validationStats, validationType);
                
                updateIndividualContribution(adr.ticker, contribuicao);
            } else {
                updateIndividualContribution(adr.ticker, 0);
                // Contar como incomplete se não tem dados
                if (!hasAfterData && !hasClosingData && !hasPreData) {
                    updateValidationStats(resultados.validationStats, 'incomplete');
                }
            }
        } else {
            updateIndividualContribution(adr.ticker, 0);
        }
    });
    
    // Calcular ADRs secundários (se habilitado)
    if (appState.incluirSecundarios) {
        adrsData.secundarios.forEach(adr => {
            const closingInput = document.getElementById(`closing-${adr.ticker}`);
            const afterInput = document.getElementById(`after-${adr.ticker}`);
            const preInput = document.getElementById(`pre-${adr.ticker}`);
            const checkbox = document.getElementById(`checkbox-${adr.ticker}`);
            
            if (closingInput && afterInput && preInput && checkbox && !checkbox.checked) {
                const closingValue = parseFloat(closingInput.value) || null;
                const afterValue = parseFloat(afterInput.value) || null;
                const preValue = parseFloat(preInput.value) || null;
                
                const hasAfterData = afterValue !== null;
                const hasClosingData = closingValue !== null;
                const hasPreData = preValue !== null;
                
                if (hasAfterData || hasClosingData || hasPreData) {
                    // Peso base (original + liquidez)
                    const pesoBase = adr.peso_ibovespa * adr.liquidez_weight;
                    
                    // Aplicar Information Ratio (INTEGRAÇÃO CUIDADOSA v2.5)
                    const irData = appState.informationRatios?.ratios?.[adr.ticker];
                    const irWeight = irData ? irData.dynamicWeight : 1.0; // Fallback seguro
                    
                    // Peso final com Information Ratio (SISTEMA SIMPLES)
                    const pesoEfetivo = pesoBase * irWeight;
                    
                    console.log(`📊 Peso ${adr.ticker} (secundário): Base ${pesoBase.toFixed(2)} × IR ${irWeight.toFixed(2)} = ${pesoEfetivo.toFixed(2)}`);
                    
                    const contribuicao = calculateValidatedContribution(adr.ticker, afterValue, closingValue, preValue, pesoEfetivo);
                    
                    resultados.secundarios.contribuicao += contribuicao;
                    resultados.secundarios.peso += pesoEfetivo;
                    resultados.secundarios.count++;
                    
                    const validationType = determineValidationType(afterValue, closingValue, preValue);
                    updateValidationStats(resultados.validationStats, validationType);
                    
                    updateIndividualContribution(adr.ticker, contribuicao);
                } else {
                    updateIndividualContribution(adr.ticker, 0);
                    if (!hasAfterData && !hasClosingData && !hasPreData) {
                        updateValidationStats(resultados.validationStats, 'incomplete');
                    }
                }
            } else {
                updateIndividualContribution(adr.ticker, 0);
            }
        });
    }
    
    // Calcular indicadores macro (ATUALIZADO v2.5 - Regime de Volatilidade Adaptativo)
    const pesoMacroDecimal = appState.pesoMacro / 100;
    
    // Atualizar regime de volatilidade antes dos cálculos
    console.log('🔄 Iniciando cálculo do regime de volatilidade...');
    const volatilityRegime = updateVolatilityRegime();
    const regimeMultiplier = volatilityRegime.multiplier;
    
    // Calcular Timing Effect (NOVO v2.5)
    const timingEffect = calculateTimingEffectScore();
    appState.timingEffect = timingEffect;
    
    // Calcular Information Ratio (SISTEMA SIMPLES)
    const informationRatioData = calculateADRInformationRatios();
    appState.informationRatios = informationRatioData;
    
    console.log('📊 Aplicando Regime de Volatilidade + Information Ratio:', {
        regime: volatilityRegime.regime,
        multiplier: regimeMultiplier,
        informationRatio: informationRatioData.summary,
        pesoMacroOriginal: appState.pesoMacro,
        pesoMacroAjustado: appState.pesoMacro * regimeMultiplier,
        vixLevel: appState.vixData.absolute,
        adrsVolatility: appState.adrsVolatility
    });
    
    // Log de monitoramento da integração do Information Ratio
    console.log('🔍 MONITORAMENTO: Information Ratio integrado aos cálculos:', {
        totalADRs: informationRatioData.summary.totalADRs,
        validADRs: informationRatioData.summary.validADRs,
        avgIR: informationRatioData.summary.avgIR.toFixed(3),
        highQuality: informationRatioData.summary.highQuality,
        mediumQuality: informationRatioData.summary.mediumQuality,
        lowQuality: informationRatioData.summary.lowQuality,
        impact: 'Pesos dos ADRs ajustados dinamicamente baseado na qualidade'
    });
    
    indicadoresMacro.forEach(indicador => {
        const input = document.getElementById(`macro-${indicador.ticker}`);
        
        if (input && input.value !== '') {
            let variacao = parseFloat(input.value) || 0;
            
            if (variacao !== 0) {
                // Aplicar correção para indicadores inversos
                if (indicador.impacto === "Inverso") {
                    variacao = -variacao;
                }
                
                // VIX também é inverso para índices
                if (indicador.ticker === "VIX") {
                    variacao = -variacao;
                }
                
                // NOVO: Aplicar multiplicador do regime de volatilidade
                const pesoMacroAjustado = pesoMacroDecimal * regimeMultiplier;
                const contribuicao = (variacao * indicador.peso_calculo * pesoMacroAjustado * appState.effectiveSensitivity) / 100;
                
                resultados.macro.contribuicao += contribuicao;
                resultados.macro.peso += indicador.peso_calculo * pesoMacroAjustado;
                resultados.macro.count++;
            }
        }
    });
    
    // Calcular contribuição VIX como INDICADOR DE VOLATILIDADE v2.4
    if (appState.vixData.variation && appState.vixData.absolute) {
        const vixVariation = appState.vixData.variation;
        const vixMagnitude = Math.abs(vixVariation);
        
        // VIX como indicador de volatilidade: quanto maior a magnitude, maior o impacto
        let vixMultiplier = 1.0;
        
        if (vixMagnitude >= 5.0) {
            vixMultiplier = 3.0; // Variação >= 5% = ALTA VOLATILIDADE
        } else if (vixMagnitude >= 3.0) {
            vixMultiplier = 2.0; // Variação >= 3% = VOLATILIDADE MODERADA
        } else if (vixMagnitude >= 1.0) {
            vixMultiplier = 1.5; // Variação >= 1% = VOLATILIDADE BAIXA
        } else {
            vixMultiplier = 1.0; // Variação < 1% = VOLATILIDADE MÍNIMA
        }
        
        // Aplicar multiplicador de volatilidade e peso VIX
        const vixContribution = (-vixVariation * vixMultiplier * (appState.pesoVix / 100) * appState.effectiveSensitivity) / 100;
        
        resultados.vix.contribuicao = vixContribution;
        resultados.vix.peso = appState.pesoVix / 100;
        
        // DEBUG: Log do VIX como indicador de volatilidade - REMOVIDO PARA PERFORMANCE
    }
    
    // Calcular totais e confiabilidade
    const saldoTotal = resultados.principais.contribuicao + 
                      resultados.secundarios.contribuicao + 
                      resultados.macro.contribuicao + 
                      resultados.vix.contribuicao;
    
    const pesoTotal = resultados.principais.peso + resultados.secundarios.peso;
    const confiabilidadeGeral = calculateOverallConfidence(resultados, pesoTotal);
    
        return {
            ...resultados,
            saldoTotal,
            pesoTotal,
            confiabilidade: confiabilidadeGeral,
            adrsComDados: resultados.principais.count + resultados.secundarios.count,
            totalAdrs: adrsData.principais.length + (appState.incluirSecundarios ? adrsData.secundarios.length : 0)
        };
    });
}

function updateValidationStats(stats, validationType) {
    switch (validationType) {
        case 'confirmed':
            stats.confirmed++;
            break;
        case 'weakened':
            stats.weakened++;
            break;
        case 'divergence':
            stats.diverged++;
            break;
        case 'only_after':
            stats.only_after++;
            break;
        case 'only_closing':
            stats.only_closing++;
            break;
        case 'only_pre':
            stats.only_pre++;
            break;
        default:
            stats.incomplete++;
            break;
    }
}

function updateIndividualContribution(ticker, contribuicao) {
    const cell = document.getElementById(`contrib-${ticker}`);
    if (cell) {
        cell.textContent = formatPercentage(contribuicao * 100, CONFIG.FORMAT.CONTRIBUTION_DECIMALS) + '%';
        cell.classList.remove('positive', 'negative');
        
        if (contribuicao > 0) {
            cell.classList.add('positive');
        } else if (contribuicao < 0) {
            cell.classList.add('negative');
        }
    }
}

function calculateOverallConfidence(resultados, pesoTotal) {
    let confiabilidade = 0;
    
    // Base: peso dos ADRs principais analisados
    const pesoMainMax = adrsData.principais.reduce((sum, adr) => sum + adr.peso_ibovespa, 0);
    const coberturaPrincipals = Math.min(1, resultados.principais.peso / pesoMainMax);
    confiabilidade += coberturaPrincipals * 40;
    
    // Bonus por validação
    const totalValidated = resultados.validationStats.confirmed + resultados.validationStats.weakened + resultados.validationStats.diverged;
    if (totalValidated > 0) {
        const validationScore = (resultados.validationStats.confirmed * 1.0 + 
                               resultados.validationStats.weakened * 0.7 + 
                               resultados.validationStats.diverged * 0.4) / totalValidated;
        confiabilidade += validationScore * 25;
    }
    
    // Dados macro disponíveis
    const macroDisponivel = resultados.macro.count / indicadoresMacro.length;
    confiabilidade += macroDisponivel * 15;
    
    // Bonus por dados VIX
    if (appState.vixData.absolute && appState.vixData.variation) {
        confiabilidade += 10;
    }
    
    // VIX Smart Adjustment
    if (appState.autoAdjustVix && appState.vixData.absolute) {
        const vixLimit = getVixSensitivityLimit(appState.vixData.absolute);
        if (vixLimit.status === 'extreme') {
            confiabilidade -= 10; // Penalizar em volatilidade extrema
        } else if (vixLimit.status === 'low') {
            confiabilidade += 5; // Bonus em mercado calmo
        }
    }
    
    // Penalizar se movimento muito extremo
    if (Math.abs(resultados.principais.contribuicao) > 0.5) {
        confiabilidade -= 10;
    }
    
    return Math.max(0, Math.min(100, Math.round(confiabilidade)));
}

function updateContributions(calcs) {
    // As contribuições individuais já são atualizadas em updateIndividualContribution
}

function updateBreakdown(calcs) {
    // ADRs Principais
    const breakdownMain = document.getElementById('breakdownMain');
    if (breakdownMain) {
        breakdownMain.textContent = formatPercentage(calcs.principais.contribuicao * 100, CONFIG.FORMAT.CONTRIBUTION_DECIMALS) + '%';
        breakdownMain.classList.remove('positive', 'negative');
        if (calcs.principais.contribuicao > 0) breakdownMain.classList.add('positive');
        else if (calcs.principais.contribuicao < 0) breakdownMain.classList.add('negative');
    }
    
    // ADRs Secundários
    const breakdownSecondary = document.getElementById('breakdownSecondary');
    if (breakdownSecondary) {
        breakdownSecondary.textContent = formatPercentage(calcs.secundarios.contribuicao * 100, CONFIG.FORMAT.CONTRIBUTION_DECIMALS) + '%';
        breakdownSecondary.classList.remove('positive', 'negative');
        if (calcs.secundarios.contribuicao > 0) breakdownSecondary.classList.add('positive');
        else if (calcs.secundarios.contribuicao < 0) breakdownSecondary.classList.add('negative');
    }
    
    // Macro
    const breakdownMacro = document.getElementById('breakdownMacro');
    if (breakdownMacro) {
        breakdownMacro.textContent = formatPercentage(calcs.macro.contribuicao * 100, CONFIG.FORMAT.CONTRIBUTION_DECIMALS) + '%';
        breakdownMacro.classList.remove('positive', 'negative');
        if (calcs.macro.contribuicao > 0) breakdownMacro.classList.add('positive');
        else if (calcs.macro.contribuicao < 0) breakdownMacro.classList.add('negative');
    }
    
    // VIX
    const breakdownVix = document.getElementById('breakdownVix');
    if (breakdownVix) {
        breakdownVix.textContent = formatPercentage(calcs.vix.contribuicao * 100, CONFIG.FORMAT.CONTRIBUTION_DECIMALS) + '%';
        breakdownVix.classList.remove('positive', 'negative');
        if (calcs.vix.contribuicao > 0) breakdownVix.classList.add('positive');
        else if (calcs.vix.contribuicao < 0) breakdownVix.classList.add('negative');
    }
    
    // Saldo Final
    const saldoFinal = document.getElementById('saldoFinal');
    if (saldoFinal) {
        saldoFinal.textContent = formatPercentage(calcs.saldoTotal * 100, CONFIG.FORMAT.CONTRIBUTION_DECIMALS) + '%';
        saldoFinal.classList.remove('positive', 'negative');
        if (calcs.saldoTotal > 0) saldoFinal.classList.add('positive');
        else if (calcs.saldoTotal < 0) saldoFinal.classList.add('negative');
    }
    
    // Confiabilidades
    const confidenceElements = {
        'confidenceMain': calcs.principais.confiabilidade,
        'confidenceSecondary': calcs.secundarios.confiabilidade,
        'confidenceMacro': calcs.macro.confiabilidade,
        'confidenceVix': calcs.vix.confiabilidade,
        'confidenceFinal': calcs.confiabilidade
    };
    
    Object.entries(confidenceElements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            if (id === 'confidenceVix') {
                element.textContent = '(VIX Impact)';
            } else {
                element.textContent = `(Confiança: ${value}%)`;
            }
        }
    });
}

function updateSummaryMetrics(calcs) {
    const pesoTotalElement = document.getElementById('pesoTotalFinal');
    if (pesoTotalElement) {
        pesoTotalElement.textContent = formatPercentage(calcs.pesoTotal, 2) + '%';
    }
    
    const adrsCountElement = document.getElementById('adrsCount');
    if (adrsCountElement) {
        adrsCountElement.textContent = `${calcs.adrsComDados}/${calcs.totalAdrs}`;
    }
    
    const validatedCountElement = document.getElementById('validatedCount');
    if (validatedCountElement) {
        const totalValidated = calcs.validationStats.confirmed + calcs.validationStats.weakened + calcs.validationStats.diverged + calcs.validationStats.only_after + calcs.validationStats.only_pre;
        validatedCountElement.textContent = `${totalValidated}/${calcs.adrsComDados}`;
    }
    
    const effectiveSensitivityElement = document.getElementById('effectiveSensitivity');
    if (effectiveSensitivityElement) {
        effectiveSensitivityElement.textContent = `${appState.effectiveSensitivity}x`;
    }
    
    // Barra de confiabilidade
    const confidenceBar = document.getElementById('confidenceBar');
    const confidenceText = document.getElementById('confidenceText');
    
    if (confidenceBar) {
        confidenceBar.style.width = `${calcs.confiabilidade}%`;
    }
    if (confidenceText) {
        confidenceText.textContent = `${calcs.confiabilidade}%`;
    }
}

function updateValidationSummary(calcs) {
    const stats = calcs.validationStats;
    
    const elements = {
        'confirmedCount': `${stats.confirmed} ADRs`,
        'weakenedCount': `${stats.weakened} ADRs`,
        'divergedCount': `${stats.diverged} ADRs`,
        'incompleteCount': `${stats.incomplete + stats.only_after + stats.only_closing + stats.only_pre} ADRs`
    };
    
    Object.entries(elements).forEach(([id, text]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = text;
        }
    });
}

function updateConfidence(confiabilidade) {
    const confidenceValue = document.getElementById('confidenceValue');
    if (confidenceValue) {
        confidenceValue.textContent = `${confiabilidade}%`;
    }
    
    const confidenceBadge = document.getElementById('confidenceBadge');
    if (confidenceBadge) {
        confidenceBadge.textContent = `${confiabilidade}%`;
    }
}

function updateInterpretation(calcs) {
    const saldo = calcs.saldoTotal;
    const confiabilidade = calcs.confiabilidade || 0;
    const vixData = appState.vixData || { absolute: 0, variation: 0 };
    const stats = calcs.validationStats || { confirmed: 0, weakened: 0, diverged: 0 };
    
    // Análise VIX Smart baseada na metodologia Professor Deivson
    const vixAnalysis = analyzeVixForInterpretation(vixData);
    const marketContext = getMarketContext(saldo, confiabilidade, vixAnalysis, stats);
    
    let interpretacao = {
        icone: marketContext.icon,
        titulo: marketContext.title,
        expectativa: marketContext.expectation,
        estrategia: marketContext.strategy
    };
    
    // Atualizar elementos do novo design
    updateInterpretationElements(interpretacao, marketContext.cardClass);
    
    // Atualizar análise detalhada com dados reais
    updateDetailedAnalysis(calcs, vixAnalysis, marketContext);
}

function analyzeVixForInterpretation(vixData) {
    const vixLevel = vixData.absolute || 0;
    const vixVariation = vixData.variation || 0;
    
    // Metodologia Professor Deivson Pimentel - Interpretação Corrigida
    let region = "neutral";
    let regionLabel = "Mercado Equilibrado";
    let regionColor = "🟡";
    let recommendation = "Modo padrão - Monitorar volatilidade";
    let marketSentiment = "Equilibrado";
    let volatilityContext = "Normal";
    
    if (vixLevel < 15) {
        region = "calm";
        regionLabel = "Mercado Tranquilo (Baixa Volatilidade)";
        regionColor = "🟢";
        recommendation = "Mercado calmo - Cuidado com reversões súbitas";
        marketSentiment = "Complacência";
        volatilityContext = "Baixa - Risco de reversão";
    } else if (vixLevel >= 15 && vixLevel < 25) {
        region = "neutral";
        regionLabel = "Mercado Equilibrado (Volatilidade Normal)";
        regionColor = "🟡";
        recommendation = "Modo padrão - Volatilidade normal";
        marketSentiment = "Equilibrado";
        volatilityContext = "Normal";
    } else if (vixLevel >= 25 && vixLevel < 35) {
        region = "concern";
        regionLabel = "Mercado com Preocupação (Alta Volatilidade)";
        regionColor = "🟠";
        recommendation = "Modo cauteloso - Medo começando a instalar";
        marketSentiment = "Preocupação";
        volatilityContext = "Alta - Medo instaurando";
    } else if (vixLevel >= 35 && vixLevel < 50) {
        region = "fear";
        regionLabel = "Mercado com Medo (Alta Volatilidade)";
        regionColor = "🔴";
        recommendation = "Modo conservador - Medo instaurado";
        marketSentiment = "Medo";
        volatilityContext = "Muito Alta - Medo instaurado";
    } else if (vixLevel >= 50) {
        region = "panic";
        regionLabel = "Mercado em Pânico (Volatilidade Extrema)";
        regionColor = "⚫";
        recommendation = "Modo ultra conservador - Pânico extremo";
        marketSentiment = "Pânico";
        volatilityContext = "Extrema - Pânico total";
    }
    
    // Relevância por percentual (+5%/-5%) - Mais cautelosa
    const isRelevant = Math.abs(vixVariation) >= 5;
    let relevance = "Baixa";
    let impact = "neutro";
    let impactDescription = "Impacto limitado no sentimento";
    
    if (isRelevant) {
        relevance = "Alta";
        if (vixVariation > 0) {
            impact = "negativo"; // VIX +5%+ = NEGATIVO para ativos de risco
            impactDescription = "Aumento do medo - Pressão vendedora";
        } else {
            impact = "positivo"; // VIX -5%+ = POSITIVO para ativos de risco
            impactDescription = "Redução do medo - Alívio comprador";
        }
    } else {
        impactDescription = "Variação limitada - Sentimento estável";
    }
    
    return {
        level: vixLevel,
        variation: vixVariation,
        region,
        regionLabel,
        regionColor,
        recommendation,
        marketSentiment,
        volatilityContext,
        relevance,
        impact,
        impactDescription,
        isRelevant
    };
}

function getMarketContext(saldo, confiabilidade, vixAnalysis, stats) {
    // Determinar viés baseado no saldo
    let bias = "neutro";
    let biasIcon = "🟡";
    let biasTitle = "VIÉS NEUTRO";
    let expectation = "Movimento lateral esperado";
    let strategy = "Aguardar confirmação";
    let cardClass = "neutral";
    
    if (saldo >= thresholds.interpretacao.muito_positivo) {
        bias = "muito_positivo";
        biasIcon = "🟢";
        biasTitle = "VIÉS FORTEMENTE POSITIVO";
        expectation = "Gap de abertura para cima (+0,30% a +0,60%)";
        strategy = "Buscar compras em recuos na abertura";
        cardClass = "positive";
    } else if (saldo >= thresholds.interpretacao.positivo) {
        bias = "positivo";
        biasIcon = "🟢";
        biasTitle = "VIÉS LEVEMENTE POSITIVO";
        expectation = "Pressão compradora (+0,10% a +0,30%)";
        strategy = "Atenção para rompimentos de resistência";
        cardClass = "positive";
    } else if (saldo >= thresholds.interpretacao.neutro_pos) {
        bias = "neutro_pos";
        biasIcon = "🟡";
        biasTitle = "VIÉS NEUTRO POSITIVO";
        expectation = "Leve viés de alta (0% a +0,15%)";
        strategy = "Aguardar breakout para definir direção";
        cardClass = "neutral";
    } else if (saldo >= thresholds.interpretacao.neutro_neg) {
        bias = "neutro";
        biasIcon = "🟡";
        biasTitle = "VIÉS NEUTRO/INDEFINIDO";
        expectation = "Movimento lateral (-0,05% a +0,05%)";
        strategy = "Aguardar confirmação de direção";
        cardClass = "neutral";
    } else if (saldo >= thresholds.interpretacao.negativo) {
        bias = "negativo";
        biasIcon = "🔴";
        biasTitle = "VIÉS LEVEMENTE NEGATIVO";
        expectation = "Pressão vendedora (-0,10% a -0,30%)";
        strategy = "Considerar hedges e vendas";
        cardClass = "negative";
    } else {
        bias = "muito_negativo";
        biasIcon = "🔴";
        biasTitle = "VIÉS FORTEMENTE NEGATIVO";
        expectation = "Gap de abertura para baixo (-0,30% a -0,60%)";
        strategy = "Proteção obrigatória";
        cardClass = "negative";
    }
    
    // Integrar análise VIX
    const vixContext = getVixContext(vixAnalysis, bias);
    
    // Gerar recomendações operacionais WINFUT específicas
    const winfutRecommendations = generateWinfutRecommendations(saldo, confiabilidade, vixAnalysis, stats, bias);
    
    return {
        icon: biasIcon,
        title: `${biasTitle} + VIX ${vixAnalysis.level.toFixed(1)} + ${vixAnalysis.regionLabel}`,
        expectation: `${expectation} com VIX Smart + Gold/Iron Ore`,
        strategy: `${strategy}. ${vixContext.strategy}`,
        cardClass,
        vixContext,
        winfutRecommendations,
        confiabilidade,
        stats
    };
}

function generateWinfutRecommendations(saldo, confiabilidade, vixAnalysis, stats, bias) {
    const recommendations = {
        entryStrategy: "",
        riskManagement: "",
        volatilityAdjustment: "",
        specificActions: []
    };
    
    // Estratégia de entrada baseada no viés
    if (bias === "muito_positivo") {
        recommendations.entryStrategy = `${CONFIG.UI.RECOMMENDATION.BUY}: Buscar entrada em recuos (pullback) após gap de abertura`;
        recommendations.specificActions.push("Aguardar recuo de 0.15-0.25% do gap para entrada");
        recommendations.specificActions.push("Stop loss: 0.20% abaixo da entrada");
        recommendations.specificActions.push("Target: 0.40-0.60% de ganho");
    } else if (bias === "positivo") {
        recommendations.entryStrategy = `${CONFIG.UI.RECOMMENDATION.BUY}: Entrada em rompimento de resistência`;
        recommendations.specificActions.push("Aguardar rompimento de resistência com volume");
        recommendations.specificActions.push("Stop loss: 0.15% abaixo da entrada");
        recommendations.specificActions.push("Target: 0.25-0.35% de ganho");
    } else if (bias === "neutro_pos") {
        recommendations.entryStrategy = `${CONFIG.UI.RECOMMENDATION.NEUTRAL}: Aguardar confirmação de direção`;
        recommendations.specificActions.push("Monitorar volume e momentum");
        recommendations.specificActions.push("Entrada apenas com confirmação clara");
        recommendations.specificActions.push("Stop loss: 0.10% abaixo da entrada");
    } else if (bias === "neutro") {
        recommendations.entryStrategy = `${CONFIG.UI.RECOMMENDATION.NEUTRAL}: Evitar posições direcionais`;
        recommendations.specificActions.push("Focar em scalping de pequenos movimentos");
        recommendations.specificActions.push("Posições muito pequenas");
        recommendations.specificActions.push("Stop loss: 0.08% abaixo da entrada");
    } else if (bias === "negativo") {
        recommendations.entryStrategy = `${CONFIG.UI.RECOMMENDATION.SELL}: Considerar vendas em resistência`;
        recommendations.specificActions.push("Aguardar teste de resistência para venda");
        recommendations.specificActions.push("Stop loss: 0.15% acima da entrada");
        recommendations.specificActions.push("Target: 0.20-0.30% de ganho");
    } else if (bias === "muito_negativo") {
        recommendations.entryStrategy = `${CONFIG.UI.RECOMMENDATION.SELL}: Buscar entrada em rally de venda`;
        recommendations.specificActions.push("Aguardar rally de venda para entrada");
        recommendations.specificActions.push("Stop loss: 0.20% acima da entrada");
        recommendations.specificActions.push("Target: 0.35-0.50% de ganho");
    }
    
    // Gestão de risco baseada na volatilidade VIX
    if (vixAnalysis.region === "calm") {
        recommendations.riskManagement = "RISCO BAIXO: Mercado tranquilo - Posições normais";
        recommendations.volatilityAdjustment = "Cuidado com reversões súbitas - Stops mais apertados";
    } else if (vixAnalysis.region === "neutral") {
        recommendations.riskManagement = "RISCO NORMAL: Volatilidade normal - Posições padrão";
        recommendations.volatilityAdjustment = "Monitorar volume e momentum";
    } else if (vixAnalysis.region === "concern") {
        recommendations.riskManagement = "RISCO ALTO: Alta volatilidade - Reduzir posições";
        recommendations.volatilityAdjustment = "Focar em scalping - Stops mais apertados";
    } else if (vixAnalysis.region === "fear") {
        recommendations.riskManagement = "RISCO MUITO ALTO: Medo instaurado - Posições pequenas";
        recommendations.volatilityAdjustment = "Apenas trades de alta probabilidade - Stops muito apertados";
    } else if (vixAnalysis.region === "panic") {
        recommendations.riskManagement = "RISCO EXTREMO: Pânico - Evitar daytrade";
        recommendations.volatilityAdjustment = "Apenas hedge - Volatilidade extrema";
    }
    
    // Ajustes baseados na confiabilidade
    if (confiabilidade > 80) {
        recommendations.specificActions.push(`✅ ALTA CONFIABILIDADE (${confiabilidade}%) - Posições maiores permitidas`);
    } else if (confiabilidade > 60) {
        recommendations.specificActions.push(`⚠️ CONFIABILIDADE MODERADA (${confiabilidade}%) - Posições normais`);
    } else if (confiabilidade > 40) {
        recommendations.specificActions.push(`⚠️ CONFIABILIDADE BAIXA (${confiabilidade}%) - Posições pequenas`);
    } else {
        recommendations.specificActions.push(`❌ CONFIABILIDADE MUITO BAIXA (${confiabilidade}%) - Evitar posições`);
    }
    
    return recommendations;
}

function getVixContext(vixAnalysis, bias) {
    let strategy = "";
    let alert = "";
    let daytradeAdvice = "";
    
    // Estratégia baseada na região VIX - Interpretação Corrigida
    if (vixAnalysis.region === "calm") {
        strategy = `VIX ${vixAnalysis.level.toFixed(1)}: ${vixAnalysis.regionLabel}. ${vixAnalysis.volatilityContext}`;
        alert = "⚠️ MERCADO TRANQUILO - Cuidado com reversões súbitas";
        daytradeAdvice = "Mercado calmo - Buscar breakouts, evitar over-trading";
    } else if (vixAnalysis.region === "neutral") {
        strategy = `VIX ${vixAnalysis.level.toFixed(1)}: ${vixAnalysis.regionLabel}. ${vixAnalysis.volatilityContext}`;
        alert = "🟡 MERCADO EQUILIBRADO - Volatilidade normal";
        daytradeAdvice = "Mercado equilibrado - Estratégias padrão, monitorar volume";
    } else if (vixAnalysis.region === "concern") {
        strategy = `VIX ${vixAnalysis.level.toFixed(1)}: ${vixAnalysis.regionLabel}. ${vixAnalysis.volatilityContext}`;
        alert = "🟠 PREOCUPAÇÃO - Medo começando a instalar";
        daytradeAdvice = "Alta volatilidade - Reduzir posições, focar em scalping";
    } else if (vixAnalysis.region === "fear") {
        strategy = `VIX ${vixAnalysis.level.toFixed(1)}: ${vixAnalysis.regionLabel}. ${vixAnalysis.volatilityContext}`;
        alert = "🔴 MEDO INSTAURADO - Alta volatilidade";
        daytradeAdvice = "Medo instaurado - Posições pequenas, stops apertados";
    } else if (vixAnalysis.region === "panic") {
        strategy = `VIX ${vixAnalysis.level.toFixed(1)}: ${vixAnalysis.regionLabel}. ${vixAnalysis.volatilityContext}`;
        alert = "⚫ PÂNICO EXTREMO - Volatilidade extrema";
        daytradeAdvice = "Pânico extremo - Evitar daytrade, apenas hedge";
    }
    
    // Impacto da variação VIX - Mais cauteloso
    if (vixAnalysis.isRelevant) {
        if (vixAnalysis.impact === "positivo") {
            strategy += ` VIX -${Math.abs(vixAnalysis.variation).toFixed(1)}% = ${vixAnalysis.impactDescription}`;
        } else if (vixAnalysis.impact === "negativo") {
            strategy += ` VIX +${vixAnalysis.variation.toFixed(1)}% = ${vixAnalysis.impactDescription}`;
        }
    } else {
        strategy += ` VIX ${vixAnalysis.variation.toFixed(1)}% = ${vixAnalysis.impactDescription}`;
    }
    
    return {
        strategy,
        alert,
        daytradeAdvice,
        region: vixAnalysis.regionLabel,
        marketSentiment: vixAnalysis.marketSentiment,
        volatilityContext: vixAnalysis.volatilityContext,
        relevance: vixAnalysis.relevance,
        impact: vixAnalysis.impact
    };
}

function updateInterpretationElements(interpretacao, cardClass) {
    const card = document.getElementById('interpretationCard');
    if (card) {
        card.className = `card interpretation-intelligent-card ${cardClass}`;
    }
    
    const iconElement = document.getElementById('interpretationIcon');
    if (iconElement) {
        iconElement.textContent = interpretacao.icone;
    }
    
    const titleElement = document.getElementById('interpretationTitle');
    if (titleElement) {
        titleElement.textContent = interpretacao.titulo;
    }
    
    const subtitleElement = document.getElementById('interpretationSubtitle');
    if (subtitleElement) {
        subtitleElement.textContent = interpretacao.expectativa;
    }
    
    const summaryTextElement = document.getElementById('summaryText');
    if (summaryTextElement) {
        summaryTextElement.textContent = interpretacao.expectativa;
    }
    
    const summaryStrategyElement = document.getElementById('summaryStrategy');
    if (summaryStrategyElement) {
        summaryStrategyElement.textContent = interpretacao.estrategia;
    }
}

function updateDetailedAnalysis(calcs, vixAnalysis, marketContext) {
    // Atualizar sinais confirmados
    updateConfirmedSignals(calcs, vixAnalysis, marketContext);
    
    // Atualizar sinais enfraquecidos
    updateWeakenedSignals(calcs, vixAnalysis, marketContext);
    
    // Atualizar oportunidade confirmada
    updateOpportunitySignals(calcs, vixAnalysis, marketContext);
}

function updateConfirmedSignals(calcs, vixAnalysis, marketContext) {
    const confirmedElement = document.getElementById('confirmedDescription');
    if (!confirmedElement) return;
    
    const stats = calcs.validationStats || { confirmed: 0, weakened: 0, diverged: 0 };
    const confiabilidade = calcs.confiabilidade || 0;
    const winfutRecs = marketContext.winfutRecommendations || {};
    
    let description = 'Aguardando dados para análise';
    
    if (stats.confirmed >= 3) {
        description = `✅ ${stats.confirmed} ADRs confirmados + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) - Confiabilidade ${confiabilidade}%`;
        if (winfutRecs.entryStrategy) {
            description += ` | ${winfutRecs.entryStrategy}`;
        }
    } else if (stats.confirmed >= 1) {
        description = `✅ ${stats.confirmed} ADR confirmado + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) - Confiabilidade ${confiabilidade}%`;
        if (winfutRecs.entryStrategy) {
            description += ` | ${winfutRecs.entryStrategy}`;
        }
    } else if (vixAnalysis.isRelevant) {
        description = `📊 VIX ${vixAnalysis.variation > 0 ? '+' : ''}${vixAnalysis.variation.toFixed(1)}% (${vixAnalysis.relevance} relevância) - ${vixAnalysis.regionLabel}`;
        if (winfutRecs.volatilityAdjustment) {
            description += ` | ${winfutRecs.volatilityAdjustment}`;
        }
    }
    
    confirmedElement.textContent = description;
}

function updateWeakenedSignals(calcs, vixAnalysis, marketContext) {
    const weakenedElement = document.getElementById('weakenedDescription');
    if (!weakenedElement) return;
    
    const stats = calcs.validationStats || { confirmed: 0, weakened: 0, diverged: 0 };
    const confiabilidade = calcs.confiabilidade || 0;
    const winfutRecs = marketContext.winfutRecommendations || {};
    
    let description = 'Aguardando dados para análise';
    
    if (stats.weakened >= 2) {
        description = `⚠️ ${stats.weakened} ADRs enfraquecidos + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) - Confiabilidade ${confiabilidade}%`;
        if (winfutRecs.riskManagement) {
            description += ` | ${winfutRecs.riskManagement}`;
        }
    } else if (stats.weakened >= 1) {
        description = `⚠️ ${stats.weakened} ADR enfraquecido + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) - Monitorar confirmação`;
        if (winfutRecs.riskManagement) {
            description += ` | ${winfutRecs.riskManagement}`;
        }
    } else if (vixAnalysis.region === "calm") {
        description = `⚠️ VIX ${vixAnalysis.level.toFixed(1)} - ${vixAnalysis.regionLabel} - Cuidado com reversões súbitas`;
        if (winfutRecs.volatilityAdjustment) {
            description += ` | ${winfutRecs.volatilityAdjustment}`;
        }
    } else if (vixAnalysis.region === "concern") {
        description = `🟠 VIX ${vixAnalysis.level.toFixed(1)} - ${vixAnalysis.regionLabel} - Medo começando a instalar`;
        if (winfutRecs.volatilityAdjustment) {
            description += ` | ${winfutRecs.volatilityAdjustment}`;
        }
    } else if (vixAnalysis.region === "fear") {
        description = `🔴 VIX ${vixAnalysis.level.toFixed(1)} - ${vixAnalysis.regionLabel} - Medo instaurado`;
        if (winfutRecs.volatilityAdjustment) {
            description += ` | ${winfutRecs.volatilityAdjustment}`;
        }
    } else if (vixAnalysis.region === "panic") {
        description = `⚫ VIX ${vixAnalysis.level.toFixed(1)} - ${vixAnalysis.regionLabel} - Pânico extremo`;
        if (winfutRecs.volatilityAdjustment) {
            description += ` | ${winfutRecs.volatilityAdjustment}`;
        }
    }
    
    weakenedElement.textContent = description;
}

function updateOpportunitySignals(calcs, vixAnalysis, marketContext) {
    const opportunityElement = document.getElementById('opportunityDescription');
    if (!opportunityElement) return;
    
    const confiabilidade = calcs.confiabilidade || 0;
    const stats = calcs.validationStats || { confirmed: 0, weakened: 0, diverged: 0 };
    const saldo = calcs.saldoTotal || 0;
    const winfutRecs = marketContext.winfutRecommendations || {};
    
    let description = 'Aguardando dados para análise';
    
    // Análise baseada em confiabilidade e contexto VIX
    if (confiabilidade > 80 && stats.confirmed >= 3) {
        description = `🎯 OPORTUNIDADE ALTA: ${stats.confirmed} ADRs confirmados + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) + Confiabilidade ${confiabilidade}%`;
        if (winfutRecs.specificActions && winfutRecs.specificActions.length > 0) {
            description += ` | ${winfutRecs.specificActions[0]}`;
        }
    } else if (confiabilidade > 60 && stats.confirmed >= 2) {
        description = `🎯 OPORTUNIDADE MODERADA: ${stats.confirmed} ADRs confirmados + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) + Confiabilidade ${confiabilidade}%`;
        if (winfutRecs.specificActions && winfutRecs.specificActions.length > 0) {
            description += ` | ${winfutRecs.specificActions[0]}`;
        }
    } else if (confiabilidade > 40) {
        description = `🎯 OPORTUNIDADE LIMITADA: Confiabilidade ${confiabilidade}% + VIX ${vixAnalysis.level.toFixed(1)} (${vixAnalysis.marketSentiment}) - Cuidado com volatilidade`;
        if (winfutRecs.volatilityAdjustment) {
            description += ` | ${winfutRecs.volatilityAdjustment}`;
        }
    } else if (vixAnalysis.region === "fear" && Math.abs(saldo) > 0.1) {
        description = `🔴 OPORTUNIDADE VIX: ${vixAnalysis.regionLabel} (VIX ${vixAnalysis.level.toFixed(1)}) + Saldo ${saldo.toFixed(2)}% - Oportunidade com cautela`;
        if (winfutRecs.daytradeAdvice) {
            description += ` | ${winfutRecs.daytradeAdvice}`;
        }
    } else if (vixAnalysis.region === "calm" && Math.abs(saldo) > 0.1) {
        description = `⚠️ CUIDADO VIX: ${vixAnalysis.regionLabel} (VIX ${vixAnalysis.level.toFixed(1)}) + Saldo ${saldo.toFixed(2)}% - Cuidado com reversões`;
        if (winfutRecs.daytradeAdvice) {
            description += ` | ${winfutRecs.daytradeAdvice}`;
        }
    } else if (stats.confirmed > 0 || stats.weakened > 0) {
        description = `🎯 OPORTUNIDADE LIMITADA: ${stats.confirmed} confirmados + ${stats.weakened} enfraquecidos - Aguardar confirmação`;
        if (winfutRecs.entryStrategy) {
            description += ` | ${winfutRecs.entryStrategy}`;
        }
    }
    
    opportunityElement.textContent = description;
}

function updateIntelligentAlerts(calcs) {
    const alertsContainer = document.getElementById('interpretationAlerts');
    if (!alertsContainer) return;
    
    alertsContainer.innerHTML = '';
    
    const alerts = [];
    const stats = calcs.validationStats;
    
    // Alertas específicos de validação
    if (stats.confirmed >= 3) {
        alerts.push({
            type: 'validation-confirmed',
            icon: '✅',
            message: `🟢 ${stats.confirmed} ADRs com sinais confirmados + VIX Smart + Gold/Iron - Alta confiabilidade na direção`
        });
    }
    
    if (stats.diverged >= 2) {
        alerts.push({
            type: 'validation-diverged',
            icon: '🔴',
            message: `🔴 ATENÇÃO: ${stats.diverged} ADRs com divergência After vs Pré-Market - Revisar análise VIX+commodities`
        });
    }
    
    if (stats.weakened >= 2) {
        alerts.push({
            type: 'validation-weakened',
            icon: '⚠️',
            message: `⚠️ ${stats.weakened} ADRs com sinais enfraquecidos - VIX Smart + Gold/Iron sugere aguardar confirmação`
        });
    }
    
    // Alertas VIX específicos
    if (appState.vixData.absolute) {
        const vixLimit = getVixSensitivityLimit(appState.vixData.absolute);
        
        if (vixLimit.status === 'extreme') {
            alerts.push({
                type: 'error',
                icon: '🔴',
                message: `VOLATILIDADE EXTREMA: VIX ${appState.vixData.absolute.toFixed(1)} - Sensibilidade reduzida para ${vixLimit.maxSensitivity}x`
            });
        } else if (vixLimit.status === 'low') {
            alerts.push({
                type: 'warning',
                icon: '⚠️',
                message: `ZONA DE COMPLACÊNCIA: VIX ${appState.vixData.absolute.toFixed(1)} - Cuidado com reversões súbitas`
            });
        }
    }

    // Alertas específicos Gold e Iron Ore v2.3
    const goldInput = document.getElementById('macro-GC=F');
    const ironInput = document.getElementById('macro-TIOC1');
    
    if (goldInput && goldInput.value) {
        const goldValue = parseFloat(goldInput.value);
        if (goldValue > 3) {
            alerts.push({
                type: 'warning',
                icon: '🥇',
                message: `OURO EM ALTA FORTE (+${goldValue.toFixed(1)}%) - Aversão a risco elevada, reduzir agressividade`
            });
        }
    }
    
    if (ironInput && ironInput.value) {
        const ironValue = parseFloat(ironInput.value);
        if (Math.abs(ironValue) > 4) {
            alerts.push({
                type: 'info',
                icon: '⛏️',
                message: `IRON ORE EXTREMO (${ironValue > 0 ? '+' : ''}${ironValue.toFixed(1)}%) - VALE3 pode ter movimento amplificado no IBOV`
            });
        }
    }

    // Combinação Gold + Iron Ore
    if (goldInput && goldInput.value && ironInput && ironInput.value) {
        const goldValue = parseFloat(goldInput.value);
        const ironValue = parseFloat(ironInput.value);
        
        if (goldValue < -2 && ironValue > 2) {
            alerts.push({
                type: 'success',
                icon: '🎯',
                message: 'COMBINAÇÃO FAVORÁVEL: Ouro caindo + Iron Ore subindo = Cenário muito positivo para IBOV'
            });
        } else if (goldValue > 2 && ironValue < -2) {
            alerts.push({
                type: 'warning',
                icon: '⚠️',
                message: 'COMBINAÇÃO DESFAVORÁVEL: Ouro subindo + Iron Ore caindo = Pressão dupla no mini índice'
            });
        }
    }
    
    // Alertas baseados na confiabilidade
    if (calcs.confiabilidade >= 85) {
        alerts.push({
            type: 'success',
            icon: '📊',
            message: 'Sinal forte validado por múltiplos indicadores + VIX Smart + Gold/Iron Sensitivity. Confiabilidade máxima.'
        });
    } else if (calcs.confiabilidade < 50) {
        alerts.push({
            type: 'warning',
            icon: '⚠️',
            message: `Apenas ${calcs.confiabilidade}% de confiabilidade. VIX Smart + commodities recomendam aguardar mais dados.`
        });
    }
    
    // Alertas de recomendação baseados na validação
    const totalValidated = stats.confirmed + stats.weakened + stats.diverged;
    if (totalValidated > 0) {
        const divergenceRatio = stats.diverged / totalValidated;
        if (divergenceRatio > 0.5) {
            alerts.push({
                type: 'error',
                icon: '📊',
                message: 'VIX Smart + Gold/Iron: Aguardar mais dados. Alta taxa de divergência entre After e Pré-Market'
            });
        } else if (stats.confirmed / totalValidated > 0.6) {
            alerts.push({
                type: 'success',
                icon: '🎯',
                message: 'Oportunidade VIX Smart + Gold/Iron confirmada: Maioria dos sinais validados consistentemente'
            });
        }
    }
    
    // Renderizar alertas
    alerts.forEach(alert => {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert--${alert.type}`;
        alertDiv.innerHTML = `${alert.icon} ${alert.message}`;
        alertsContainer.appendChild(alertDiv);
    });
}

// Market Sentiment Intelligence Functions
function calculateMarketSentiment() {
    const components = {
        vix: calculateVixSentiment(),
        gold: calculateGoldSentiment(),
        iron: calculateIronSentiment(),
        adrs: calculateADRsSentiment(),
        momentum: calculateMomentumSentiment()
    };
    
    // Pesos dos componentes (total = 100%)
    const weights = {
        vix: 30,      // VIX tem maior peso
        gold: 20,     // Gold como safe haven
        iron: 15,     // Iron Ore para commodities
        adrs: 20,     // ADRs correlation
        momentum: 15  // Market momentum
    };
    
    // Calcular sentimento ponderado
    let totalSentiment = 0;
    let totalWeight = 0;
    
    Object.keys(components).forEach(key => {
        if (components[key] !== null) {
            totalSentiment += components[key] * weights[key];
            totalWeight += weights[key];
        }
    });
    
    const finalSentiment = totalWeight > 0 ? Math.round(totalSentiment / totalWeight) : 50;
    
    return {
        score: Math.max(0, Math.min(100, finalSentiment)),
        components: components,
        weights: weights
    };
}

function calculateVixSentiment() {
    if (!appState.vixData.absolute) return null;
    
    const vix = appState.vixData.absolute;
    
    // VIX inverso: alto VIX = Fear, baixo VIX = Greed
    if (vix >= 40) return 10;      // Extreme Fear
    if (vix >= 30) return 25;      // Fear
    if (vix >= 20) return 50;      // Neutral
    if (vix >= 15) return 75;      // Greed
    return 90;                     // Extreme Greed
}

function calculateGoldSentiment() {
    const goldInput = document.getElementById('macro-GC=F');
    if (!goldInput || !goldInput.value) return null;
    
    const goldChange = parseFloat(goldInput.value);
    
    // Gold inverso: alta do ouro = Fear, baixa do ouro = Greed
    if (goldChange >= 3) return 15;      // Strong Fear
    if (goldChange >= 1) return 30;      // Fear
    if (goldChange >= -1) return 50;     // Neutral
    if (goldChange >= -3) return 70;     // Greed
    return 85;                           // Strong Greed
}

function calculateIronSentiment() {
    const ironInput = document.getElementById('macro-TIOC1');
    if (!ironInput || !ironInput.value) return null;
    
    const ironChange = parseFloat(ironInput.value);
    
    // Iron Ore direto: alta = Greed, baixa = Fear
    if (ironChange >= 4) return 85;      // Strong Greed
    if (ironChange >= 2) return 70;      // Greed
    if (ironChange >= -2) return 50;     // Neutral
    if (ironChange >= -4) return 30;     // Fear
    return 15;                           // Strong Fear
}

function calculateADRsSentiment() {
    const adrsSignal = calculateADRsSignal();
    
    // Converter sinal ADRs para sentimento (0-100)
    if (adrsSignal >= 0.3) return 85;   // Strong Greed
    if (adrsSignal >= 0.1) return 70;   // Greed
    if (adrsSignal >= -0.1) return 50;  // Neutral
    if (adrsSignal >= -0.3) return 30;  // Fear
    return 15;                          // Strong Fear
}

function calculateMomentumSentiment() {
    // Combinar indicadores macro para momentum
    const macroInputs = ['macro-EWZ_CLOSE', 'macro-ES=F', 'macro-CL=F', 'macro-DXY'];
    let totalMomentum = 0;
    let count = 0;
    
    macroInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input && input.value) {
            const value = parseFloat(input.value);
            totalMomentum += value;
            count++;
        }
    });
    
    if (count === 0) return null;
    
    const avgMomentum = totalMomentum / count;
    
    // Converter momentum para sentimento
    if (avgMomentum >= 2) return 80;    // Strong Greed
    if (avgMomentum >= 0.5) return 65;  // Greed
    if (avgMomentum >= -0.5) return 50; // Neutral
    if (avgMomentum >= -2) return 35;   // Fear
    return 20;                          // Strong Fear
}

function updateMarketSentiment() {
    const sentiment = calculateMarketSentiment();
    
    // Atualizar indicador de sentimento simplificado
    updateSentimentIndicator(sentiment.score, sentiment.components);
}

// ===== INDICADOR DE SENTIMENTO SIMPLIFICADO =====
function updateSentimentIndicator(score, components) {
    const sentimentScore = document.getElementById('sentimentScore');
    const sentimentLabel = document.getElementById('sentimentLabel');
    const sentimentFill = document.getElementById('sentimentFill');
    const sentimentStatus = document.getElementById('sentimentStatus');
    
    if (sentimentScore) {
        sentimentScore.textContent = score;
    }
    
    if (sentimentLabel) {
        let label = 'NEUTRO';
        if (score <= 20) label = 'MEDO EXTREMO';
        else if (score <= 40) label = 'MEDO';
        else if (score <= 60) label = 'NEUTRO';
        else if (score <= 80) label = 'GANÂNCIA';
        else label = 'GANÂNCIA EXTREMA';
        
        sentimentLabel.textContent = label;
    }
    
    if (sentimentFill) {
        sentimentFill.style.width = `${score}%`;
        
        // Atualizar cor baseada no score
        if (score <= 20) {
            sentimentFill.style.background = '#ef4444'; // Vermelho
        } else if (score <= 40) {
            sentimentFill.style.background = '#f59e0b'; // Laranja
        } else if (score <= 60) {
            sentimentFill.style.background = '#10b981'; // Verde neutro
        } else if (score <= 80) {
            sentimentFill.style.background = '#3b82f6'; // Azul
        } else {
            sentimentFill.style.background = '#8b5cf6'; // Roxo
        }
    }
    
    // Atualizar status detalhado
    if (sentimentStatus) {
        let statusIcon = '🟡';
        let statusText = 'Aguardando dados';
        
        // Determinar status baseado no score e componentes
        const validComponents = Object.values(components).filter(c => c !== null).length;
        
        if (validComponents >= 3) {
            if (score <= 30) {
                statusIcon = '🔴';
                statusText = 'VIÉS FORTEMENTE NEGATIVO - Oportunidade de compra';
            } else if (score >= 70) {
                statusIcon = '🟢';
                statusText = 'VIÉS FORTEMENTE POSITIVO - Cuidado com correção';
            } else if (score >= 50) {
                statusIcon = '🟡';
                statusText = 'VIÉS LEVEMENTE POSITIVO - Tendência positiva';
            } else {
                statusIcon = '🟠';
                statusText = 'VIÉS LEVEMENTE NEGATIVO - Tendência negativa';
            }
        } else if (validComponents >= 1) {
            statusIcon = '🟡';
            statusText = 'Dados insuficientes - Aguardando mais informações';
        }
        
        sentimentStatus.innerHTML = `
            <div class="status-item">
                <span class="status-icon">${statusIcon}</span>
                <span class="status-text">${statusText}</span>
            </div>
        `;
    }
    
    // console.log(`📊 Sentimento atualizado: ${score} - ${sentimentLabel?.textContent}`);
}

function updateSentimentGauge(score) {
    const gaugeValue = document.getElementById('gaugeValue');
    const gaugeLabel = document.getElementById('gaugeLabel');
    const gaugeFill = document.getElementById('gaugeFill');
    
    if (gaugeValue) gaugeValue.textContent = score;
    
    // Determinar label baseado no score
    let label = 'Neutral';
    let labelClass = 'neutral';
    
    if (score <= 20) {
        label = 'Extreme Fear';
        labelClass = 'fear';
    } else if (score <= 40) {
        label = 'Fear';
        labelClass = 'fear';
    } else if (score <= 60) {
        label = 'Neutral';
        labelClass = 'neutral';
    } else if (score <= 80) {
        label = 'Greed';
        labelClass = 'greed';
    } else {
        label = 'Extreme Greed';
        labelClass = 'greed';
    }
    
    if (gaugeLabel) {
        gaugeLabel.textContent = label;
        gaugeLabel.className = `gauge-label gauge-label--${labelClass}`;
    }
    
    // Animar gauge
    if (gaugeFill) {
        gaugeFill.style.transform = `rotate(${(score * 3.6) - 90}deg)`;
    }
}

function updateSentimentComponents(components) {
    const container = document.getElementById('sentimentComponents');
    if (!container) return;
    
    container.innerHTML = '';
    
    const componentData = [
        { key: 'vix', name: 'VIX', icon: '📊', value: components.vix },
        { key: 'gold', name: 'Gold', icon: '🥇', value: components.gold },
        { key: 'iron', name: 'Iron Ore', icon: '⛏️', value: components.iron },
        { key: 'adrs', name: 'ADRs', icon: '📈', value: components.adrs },
        { key: 'momentum', name: 'Momentum', icon: '⚡', value: components.momentum }
    ];
    
    componentData.forEach(comp => {
        if (comp.value === null) return;
        
        const componentDiv = document.createElement('div');
        componentDiv.className = 'sentiment-component';
        
        const label = getSentimentLabel(comp.value);
        const valueClass = getSentimentValueClass(comp.value);
        
        componentDiv.innerHTML = `
            <div class="sentiment-component-label">
                <span>${comp.icon}</span>
                <span>${comp.name}</span>
            </div>
            <div class="sentiment-component-value ${valueClass}">
                ${label}
            </div>
        `;
        
        container.appendChild(componentDiv);
    });
}

function updateTradingSignals(score, components) {
    const container = document.getElementById('signalCards');
    if (!container) return;
    
    container.innerHTML = '';
    
    const signals = generateTradingSignals(score, components);
    
    signals.forEach(signal => {
        const signalDiv = document.createElement('div');
        signalDiv.className = `signal-card ${signal.type}`;
        
        signalDiv.innerHTML = `
            <div class="signal-header">
                <span class="signal-icon">${signal.icon}</span>
                <span class="signal-title">${signal.title}</span>
            </div>
            <div class="signal-description">${signal.description}</div>
        `;
        
        container.appendChild(signalDiv);
    });
}

function generateTradingSignals(score, components) {
    const signals = [];
    
    // Sinal principal baseado no score
    if (score <= 25) {
        signals.push({
            type: 'buy',
            icon: '🟢',
            title: 'BUY OPPORTUNITY',
            description: 'Mercado em Fear extremo - Oportunidade de compra com ADRs oversold'
        });
    } else if (score >= 75) {
        signals.push({
            type: 'sell',
            icon: '🔴',
            title: 'SELL SIGNAL',
            description: 'Mercado em Greed extremo - Considerar tomada de lucro'
        });
    } else if (score >= 60) {
        signals.push({
            type: 'caution',
            icon: '⚠️',
            title: 'CAUTION',
            description: 'Mercado em Greed - Monitorar sinais de reversão'
        });
    } else if (score <= 40) {
        signals.push({
            type: 'hold',
            icon: '📊',
            title: 'HOLD',
            description: 'Mercado em Fear - Aguardar reversão'
        });
    } else {
        signals.push({
            type: 'hold',
            icon: '📊',
            title: 'NEUTRAL',
            description: 'Mercado neutro - Aguardar sinais'
        });
    }
    
    // Sinais específicos baseados em componentes
    if (components.vix && components.vix <= 25) {
        signals.push({
            type: 'buy',
            icon: '📊',
            title: 'VIX LOW',
            description: 'VIX baixo indica complacência - Cuidado com reversões súbitas'
        });
    }
    
    if (components.gold && components.gold <= 30) {
        signals.push({
            type: 'buy',
            icon: '🥇',
            title: 'GOLD FEAR',
            description: 'Ouro em alta indica aversão a risco - Oportunidade de compra'
        });
    }
    
    if (components.iron && components.iron >= 70) {
        signals.push({
            type: 'buy',
            icon: '⛏️',
            title: 'IRON STRONG',
            description: 'Iron Ore forte - VALE3 pode puxar IBOV para cima'
        });
    }
    
    return signals;
}

function getSentimentLabel(value) {
    if (value <= 20) return 'Extreme Fear';
    if (value <= 40) return 'Fear';
    if (value <= 60) return 'Neutral';
    if (value <= 80) return 'Greed';
    return 'Extreme Greed';
}

function getSentimentValueClass(value) {
    if (value <= 20) return 'fear';
    if (value <= 40) return 'fear';
    if (value <= 60) return 'neutral';
    if (value <= 80) return 'greed';
    return 'greed';
}

// Funções para controlar indicadores de status
function updateDataStatus(status) {
    const statusElement = document.getElementById('dataStatus');
    if (!statusElement) return;
    
    // Remover classes antigas
    statusElement.className = 'status-badge';
    
    // Adicionar classe e conteúdo baseado no status
    switch(status) {
        case 'saved':
            statusElement.className += ' status-badge--saved';
            statusElement.textContent = CONFIG.UI.STATUS.SAVED;
            break;
        case 'calculating':
            statusElement.className += ' status-badge--calculating';
            statusElement.textContent = CONFIG.UI.STATUS.CALCULATING;
            break;
        case 'unsaved':
            statusElement.className += ' status-badge--unsaved';
            statusElement.textContent = CONFIG.UI.STATUS.UNSAVED;
            break;
        case 'error':
            statusElement.className += ' status-badge--error';
            statusElement.textContent = CONFIG.UI.STATUS.ERROR;
            break;
        default:
            statusElement.className += ' status-badge--saved';
            statusElement.textContent = CONFIG.UI.STATUS.SAVED;
    }
}

// Detectar mudanças nos inputs para mostrar "Dados Não Salvos"
function setupChangeDetection() {
    const inputs = document.querySelectorAll('input[type="number"], input[type="range"]');
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            updateDataStatus('unsaved');
        });
    });
}

// Funções de Persistência v2.3
function saveSession() {
    try {
        updateDataStatus('calculating'); // Mostrar "Calculando..."
        
        const sessionData = {
            timestamp: new Date().toISOString(),
            version: "2.3",
            afterMarket: {},
            preMarket: {},
            macroIndicators: {},
            vixData: { ...appState.vixData },
            settings: { ...appState }
        };
        
        // Salvar dados after-market
        [...adrsData.principais, ...adrsData.secundarios].forEach(adr => {
            const afterInput = document.getElementById(`after-${adr.ticker}`);
            const preInput = document.getElementById(`pre-${adr.ticker}`);
            const checkbox = document.getElementById(`checkbox-${adr.ticker}`);
            
            if (afterInput && afterInput.value) {
                sessionData.afterMarket[adr.ticker] = parseFloat(afterInput.value);
            }
            if (preInput && preInput.value) {
                sessionData.preMarket[adr.ticker] = parseFloat(preInput.value);
            }
            if (checkbox && checkbox.checked) {
                sessionData.afterMarket[adr.ticker] = null;
                sessionData.preMarket[adr.ticker] = null;
            }
        });
        
        // Salvar dados macro
        indicadoresMacro.forEach(indicador => {
            const input = document.getElementById(`macro-${indicador.ticker}`);
            if (input && input.value) {
                sessionData.macroIndicators[indicador.ticker] = parseFloat(input.value);
            }
        });
        
        // Salvar dados VIX standalone
        const vixVariationInput = document.getElementById('vixVariation');
        const vixAbsoluteInput = document.getElementById('vixAbsolute');
        
        if (vixVariationInput && vixVariationInput.value) {
            sessionData.vixData.variation = parseFloat(vixVariationInput.value);
        }
        if (vixAbsoluteInput && vixAbsoluteInput.value) {
            sessionData.vixData.absolute = parseFloat(vixAbsoluteInput.value);
        }
        
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionData));
        updateSessionStatus('saved');
        
        // Atualizar status visual
        updateDataStatus('saved');
        
        return true;
    } catch (error) {
        console.error('Erro ao salvar sessão:', error);
        updateDataStatus('error');
        showAlert('Erro ao salvar dados da sessão', 'error');
        return false;
    }
}

function loadSession() {
    try {
        const savedData = localStorage.getItem(STORAGE_KEY);
        if (!savedData) {
            updateSessionStatus('new');
            return false;
        }
        
        const sessionData = JSON.parse(savedData);
        
        // Carregar configurações
        if (sessionData.settings) {
            appState = { ...appState, ...sessionData.settings };
            updateConfigurationUI();
        }
        
        // Carregar dados VIX
        if (sessionData.vixData) {
            appState.vixData = { ...appState.vixData, ...sessionData.vixData };
            
            const vixVariationInput = document.getElementById('vixVariation');
            const vixAbsoluteInput = document.getElementById('vixAbsolute');
            
            if (vixVariationInput && appState.vixData.variation) {
                vixVariationInput.value = appState.vixData.variation;
            }
            if (vixAbsoluteInput && appState.vixData.absolute) {
                vixAbsoluteInput.value = appState.vixData.absolute;
            }
            
            // CORREÇÃO: Aplicar correção de sensibilidade VIX após carregar dados
            correctVixSensitivity();
        }
        
        // Carregar dados after-market
        Object.entries(sessionData.afterMarket || {}).forEach(([ticker, value]) => {
            const input = document.getElementById(`after-${ticker}`);
            const checkbox = document.getElementById(`checkbox-${ticker}`);
            
            if (input && checkbox) {
                if (value === null) {
                    checkbox.checked = true;
                    input.disabled = true;
                    input.value = '';
                    const row = input.closest('tr');
                    if (row) row.classList.add('disabled-row');
                } else {
                    input.value = value.toString();
                    if (value > 0) input.classList.add('positive');
                    else if (value < 0) input.classList.add('negative');
                }
            }
        });
        
        // Carregar dados pré-market
        Object.entries(sessionData.preMarket || {}).forEach(([ticker, value]) => {
            const input = document.getElementById(`pre-${ticker}`);
            
            if (input && value !== null) {
                input.value = value.toString();
                if (value > 0) input.classList.add('positive');
                else if (value < 0) input.classList.add('negative');
            }
        });
        
        // Carregar dados macro
        Object.entries(sessionData.macroIndicators || {}).forEach(([ticker, value]) => {
            const input = document.getElementById(`macro-${ticker}`);
            
            if (input) {
                input.value = value.toString();
                if (value > 0) input.classList.add('positive');
                else if (value < 0) input.classList.add('negative');
            }
        });
        
        // Atualizar validações e cálculos
        [...adrsData.principais, ...adrsData.secundarios].forEach(adr => {
            updateValidationStatus(adr.ticker);
        });
        
        updateVixInterface();
        updateAllCalculations();
        updateSessionStatus('loaded', sessionData.timestamp);
        
        showAlert('Dados da sessão v2.3 carregados com sucesso', 'success');
        return true;
        
    } catch (error) {
        console.error('Erro ao carregar sessão:', error);
        showAlert('Erro ao carregar dados da sessão anterior', 'warning');
        updateSessionStatus('new');
        return false;
    }
}

function clearSession() {
    try {
        localStorage.removeItem(STORAGE_KEY);
        
        // Limpar interface
        clearAllData();
        
        // Reset configurações
        appState = {
            sensibilidade: 1.0,
            incluirSecundarios: true,
            pesoMacro: 25,
            pesoVix: 10, // atualizado
            autoAdjustVix: true,
            modoAnalise: 'complete',
            autoSave: true,
            nightMode: appState.nightMode, // Manter preferência de tema
            vixData: {
                variation: null,
                absolute: null
            },
            effectiveSensitivity: 1.0
        };
        
        updateConfigurationUI();
        updateVixInterface();
        updateSessionStatus('new');
        
        showAlert('Nova sessão v2.3 iniciada. Todos os dados foram limpos.', 'info');
        
    } catch (error) {
        console.error('Erro ao limpar sessão:', error);
        showAlert('Erro ao iniciar nova sessão', 'error');
    }
}

function updateConfigurationUI() {
    // Atualizar controles de configuração com valores do appState
    const sensibilityRange = document.getElementById('sensibilityRange');
    const sensibilityValue = document.getElementById('sensibilityValue');
    const includeSecondary = document.getElementById('includeSecondary');
    const macroWeight = document.getElementById('macroWeight');
    const macroWeightValue = document.getElementById('macroWeightValue');
    const vixWeight = document.getElementById('vixWeight');
    const vixWeightValue = document.getElementById('vixWeightValue');
    const autoAdjustVix = document.getElementById('autoAdjustVix');
    const autoSave = document.getElementById('autoSave');
    
    if (sensibilityRange && sensibilityValue) {
        sensibilityRange.value = appState.sensibilidade;
        sensibilityValue.textContent = `${appState.sensibilidade}x`;
    }
    
    if (includeSecondary) {
        includeSecondary.checked = appState.incluirSecundarios;
        toggleSecondarySection(appState.incluirSecundarios);
    }
    
    if (macroWeight && macroWeightValue) {
        macroWeight.value = appState.pesoMacro;
        macroWeightValue.textContent = `${appState.pesoMacro}%`;
    }
    
    if (vixWeight && vixWeightValue) {
        vixWeight.value = appState.pesoVix;
        vixWeightValue.textContent = `${appState.pesoVix}%`;
    }
    
    if (autoAdjustVix) {
        autoAdjustVix.checked = appState.autoAdjustVix;
    }
    
    if (autoSave) {
        autoSave.checked = appState.autoSave;
    }
    
    // Atualizar radio buttons
    document.querySelectorAll('input[name="analysisMode"]').forEach(radio => {
        radio.checked = radio.value === appState.modoAnalise;
    });
}

function updateSessionStatus(status, timestamp = null) {
    const statusElement = document.getElementById('sessionTimestamp');
    if (!statusElement) return;
    
    const now = new Date();
    let statusText = '';
    let statusClass = '';
    
    switch (status) {
        case 'loaded':
            const loadDate = timestamp ? new Date(timestamp) : now;
            statusText = `Sessão v2.3 carregada: ${loadDate.toLocaleString('pt-BR')}`;
            statusClass = 'session-status--loaded';
            break;
        case 'saved':
            statusText = `Salvo automaticamente v2.3: ${now.toLocaleString('pt-BR')}`;
            statusClass = 'session-status--saved';
            break;
        case 'new':
            statusText = 'Nova sessão v2.3 iniciada';
            statusClass = 'session-status--new';
            break;
    }
    
    statusElement.textContent = statusText;
    statusElement.parentElement.className = `session-status ${statusClass}`;
}

function toggleSecondarySection(show) {
    const section = document.getElementById('secondarySection');
    if (section) {
        section.style.display = show ? 'block' : 'none';
    }
}

function updateMacroWeights() {
    const pesoTotal = appState.pesoMacro;
    document.querySelectorAll('.macro-weight').forEach((element, index) => {
        if (indicadoresMacro[index]) {
            const indicador = indicadoresMacro[index];
            const pesoAjustado = Math.round(indicador.peso_calculo * pesoTotal);
            element.textContent = `Peso: ${pesoAjustado}%`;
        }
    });
}

// Funções globais para os botões (removidas - cenários descritivos são apenas informativos)

function clearAllData() {
    
    // Limpar ADRs principais
    adrsData.principais.forEach(adr => {
        const closingInput = document.getElementById(`closing-${adr.ticker}`);
        const afterInput = document.getElementById(`after-${adr.ticker}`);
        const preInput = document.getElementById(`pre-${adr.ticker}`);
        const checkbox = document.getElementById(`checkbox-${adr.ticker}`);
        
        if (closingInput && afterInput && preInput && checkbox) {
            closingInput.value = '';
            afterInput.value = '';
            preInput.value = '';
            checkbox.checked = false;
            closingInput.disabled = false;
            afterInput.disabled = false;
            preInput.disabled = false;
            closingInput.classList.remove('positive', 'negative');
            afterInput.classList.remove('positive', 'negative');
            preInput.classList.remove('positive', 'negative');
            const row = closingInput.closest('tr');
            if (row) row.classList.remove('disabled-row');
        }
    });
    
    // Limpar ADRs secundários
    adrsData.secundarios.forEach(adr => {
        const closingInput = document.getElementById(`closing-${adr.ticker}`);
        const afterInput = document.getElementById(`after-${adr.ticker}`);
        const preInput = document.getElementById(`pre-${adr.ticker}`);
        const checkbox = document.getElementById(`checkbox-${adr.ticker}`);
        
        if (closingInput && afterInput && preInput && checkbox) {
            closingInput.value = '';
            afterInput.value = '';
            preInput.value = '';
            checkbox.checked = false;
            closingInput.disabled = false;
            afterInput.disabled = false;
            preInput.disabled = false;
            closingInput.classList.remove('positive', 'negative');
            afterInput.classList.remove('positive', 'negative');
            preInput.classList.remove('positive', 'negative');
            const row = closingInput.closest('tr');
            if (row) row.classList.remove('disabled-row');
        }
    });
    
    // Limpar indicadores macro
    document.querySelectorAll('.macro-input').forEach(input => {
        input.value = '';
        input.classList.remove('positive', 'negative');
    });
    
    // Limpar dados VIX
    const vixVariationInput = document.getElementById('vixVariation');
    const vixAbsoluteInput = document.getElementById('vixAbsolute');
    
    if (vixVariationInput) vixVariationInput.value = '';
    if (vixAbsoluteInput) vixAbsoluteInput.value = '';
    
    appState.vixData = {
        variation: null,
        absolute: null
    };
    
    // Atualizar validações e cálculos
    setTimeout(() => {
        [...adrsData.principais, ...adrsData.secundarios].forEach(adr => {
            updateValidationStatus(adr.ticker);
        });
        updateVixInterface();
        updateAllCalculations();
    }, 50);
    
}

function formatPercentage(value, decimals = 2) {
    if (typeof value !== 'number') {
        return '0,00';
    }
    return value.toLocaleString('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function showAlert(message, type) {
    const existingAlert = document.querySelector('.temp-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    const icons = {
        success: '✅',
        warning: '⚠️',
        error: '❌',
        info: 'ℹ️'
    };
    
    const alert = document.createElement('div');
    alert.className = `alert alert--${type} temp-alert`;
    alert.innerHTML = `${icons[type] || 'ℹ️'} ${message}`;
    alert.style.position = 'fixed';
    alert.style.top = '20px';
    alert.style.right = '20px';
    alert.style.zIndex = '1000';
    alert.style.minWidth = '300px';
    alert.style.maxWidth = '400px';
    alert.style.boxShadow = 'var(--shadow-lg)';
    
    document.body.appendChild(alert);
    
    setTimeout(() => {
        if (alert.parentNode) {
            alert.parentNode.removeChild(alert);
        }
    }, 5000);
}

// Market Data Service - Integração com Backend
class MarketDataService {
    constructor() {
        const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
        this.baseUrl = isProduction 
            ? 'https://backendcalculadora-adrr.onrender.com/api'
            : 'http://localhost:5000/api';
        this.updateInterval = 30000; // 30 segundos
        this.isEnabled = false;
        this.updateTimer = null;
        this.retryCount = 0;
        this.maxRetries = 3;
    }
    
    async fetchMarketData() {
        try {
            // Usar AbortController para timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${this.baseUrl}/market-data`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            this.retryCount = 0; // Reset retry count on success
            return data;
        } catch (error) {
            console.warn('Erro ao buscar dados do backend:', error.message);
            this.retryCount++;
            
            if (this.retryCount >= this.maxRetries) {
                this.updateStatus('error', 'Erro de conexão');
                this.stopLiveUpdates();
            }
            
            return null;
        }
    }
    
    async updateLiveData() {
        if (!this.isEnabled) return;
        
        // // console.log('🔄 Iniciando atualização de dados ao vivo...');
        this.updateStatus('connecting', 'Conectando...');
        
        try {
            // // console.log(`📡 Buscando dados de: ${this.baseUrl}/market-data`);
            const data = await this.fetchMarketData();
            
            if (data) {
                // console.log('✅ Dados recebidos do backend:', data);
                
                if (data.status === 'success') {
                    // Atualizar dados com validação
                    if (data.data) {
                        // console.log('📊 Atualizando dados...');
                        this.updateVixData(data.data.vix);
                        this.updateGoldData(data.data.gold);
                        this.updateIronData(data.data.iron);
                        this.updateADRsData(data.data.adrs);
                        
                        // Adicionar VIX aos dados macro
                        const macroDataWithVix = {
                            ...data.data.macro,
                            vix: data.data.vix
                        };
                        this.updateMacroData(macroDataWithVix);
                        
                        // WINFUT agora é entrada manual - não precisa buscar dados automáticos
                        // console.log('📊 WINFUT configurado para entrada manual');
                        
                        this.updateStatus('connected', 'Conectado');
                        this.updateLastUpdateTime(data.timestamp);
                        
                        // Atualizar cálculos
                        updateAllCalculations();
                        // console.log('✅ Dados ao vivo atualizados com sucesso');
                    } else {
                        console.warn('⚠️ Estrutura de dados inesperada:', data);
                        this.updateStatus('error', 'Estrutura de dados inválida');
                    }
                } else {
                    console.error('❌ Erro na resposta do backend:', data);
                    this.updateStatus('error', 'Erro nos dados');
                }
            } else {
                console.error('❌ Nenhum dado recebido do backend');
                this.updateStatus('error', 'Sem dados');
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar dados ao vivo:', error);
            this.updateStatus('error', 'Erro de conexão');
        }
    }
    
    updateVixData(vixData) {
        if (!vixData) {
            console.warn('Dados VIX não disponíveis');
            return;
        }
        
        const vixVariationInput = document.getElementById('vixVariation');
        const vixAbsoluteInput = document.getElementById('vixAbsolute');
        
        if (vixVariationInput && vixData.variation !== null && vixData.variation !== undefined) {
            vixVariationInput.value = vixData.variation.toFixed(2);
            vixVariationInput.classList.add('live-updated');
            // console.log(`VIX variação: ${vixData.variation.toFixed(2)}%`);
        }
        
        if (vixAbsoluteInput && vixData.current !== null && vixData.current !== undefined) {
            vixAbsoluteInput.value = vixData.current.toFixed(1);
            vixAbsoluteInput.classList.add('live-updated');
            // console.log(`VIX absoluto: ${vixData.current.toFixed(1)}`);
        }
        
        // Atualizar appState
        if (vixData.current !== null && vixData.current !== undefined) {
            appState.vixData.absolute = vixData.current;
        }
        if (vixData.variation !== null && vixData.variation !== undefined) {
            appState.vixData.variation = vixData.variation;
        }
        
        // CORREÇÃO: Aplicar correção de sensibilidade VIX
        correctVixSensitivity();
    }
    
    updateGoldData(goldData) {
        if (!goldData) {
            console.warn('Dados Gold não disponíveis');
            return;
        }
        
        const goldInput = document.getElementById('macro-GC=F');
        if (goldInput && goldData.variation !== null && goldData.variation !== undefined) {
            goldInput.value = goldData.variation.toFixed(2);
            goldInput.classList.add('live-updated');
            // console.log(`Gold variação: ${goldData.variation.toFixed(2)}%`);
        } else {
            console.warn('Elemento Gold não encontrado ou dados inválidos');
        }
    }
    
    updateIronData(ironData) {
        if (!ironData) {
            console.warn('Dados Iron não disponíveis');
            return;
        }
        
        const ironInput = document.getElementById('macro-TIOC1');
        if (ironInput && ironData.variation !== null && ironData.variation !== undefined) {
            ironInput.value = ironData.variation.toFixed(2);
            ironInput.classList.add('live-updated');
            // console.log(`Iron variação: ${ironData.variation.toFixed(2)}%`);
        } else {
            console.warn('Elemento Iron não encontrado ou dados inválidos');
        }
    }
    
    updateADRsData(adrsData) {
        if (!adrsData) return;
        
        // Inicializar objeto global para armazenar preços reais
        if (!window.adrPrices) {
            window.adrPrices = {};
        }
        
        Object.keys(adrsData).forEach(ticker => {
            const data = adrsData[ticker];
            if (data) {
                // Armazenar preço real para uso na análise de spread
                if (data.current && data.current > 0) {
                    window.adrPrices[ticker] = {
                        price: data.current,
                        variation: data.variation,
                        timestamp: data.timestamp
                    };
                    // console.log(`💰 Preço real ${ticker} armazenado: R$ ${data.current}`);
                }
                
                // MODIFICADO: Dados vão para FECHAMENTO (não after-market)
                if (data.data_type === 'closing' || data.source === 'closing-price') {
                    const closingInput = document.getElementById(`closing-${ticker}`);
                    if (closingInput) {
                        closingInput.value = data.variation.toFixed(2);
                        closingInput.classList.add('live-updated');
                        // console.log(`✅ ADR ${ticker} FECHAMENTO atualizado: ${data.variation.toFixed(2)}%`);
                    }
                }
                
                // After-market fica vazio para preenchimento manual
                // console.log(`ℹ️ After-market ${ticker} deixado vazio para preenchimento manual`);
            }
        });
    }
    
    updateMacroData(macroData) {
        if (!macroData) return;
        
        // console.log('📊 Dados macro recebidos:', macroData);
        
        const macroMapping = {
            'ewz': 'macro-EWZ_CLOSE',
            'sp500': 'macro-ES=F',
            'oil': 'macro-CL=F',
            'dxy': 'macro-DXY',
            'vix': 'macro-VIX'
        };
        
        Object.keys(macroMapping).forEach(key => {
            const inputId = macroMapping[key];
            const input = document.getElementById(inputId);
            const data = macroData[key];
            
            // console.log(`🔍 Processando ${key}:`, { inputId, data, input: !!input });
            
            if (input && data && data.variation !== null) {
                input.value = data.variation.toFixed(2);
                input.classList.add('live-updated');
                // console.log(`✅ Atualizado ${key}: ${data.variation.toFixed(2)}%`);
            } else {
                // console.warn(`❌ Elemento não encontrado ou dados inválidos: ${inputId}`, data);
            }
        });
    }
    
    updateStatus(status, text) {
        const statusElement = document.getElementById('liveDataStatus');
        if (!statusElement) return;
        
        // Remover classes anteriores
        statusElement.className = 'live-status-indicator';
        
        // Adicionar nova classe
        statusElement.classList.add(status);
        
        // Atualizar texto
        const textElement = statusElement.querySelector('.status-text');
        if (textElement) {
            textElement.textContent = text;
        }
        
        // Adicionar animação de sucesso
        if (status === 'connected') {
            statusElement.classList.add('success');
            setTimeout(() => {
                statusElement.classList.remove('success');
            }, 600);
        }
    }
    
    updateLastUpdateTime(timestamp) {
        const timeElement = document.getElementById('lastUpdateTime');
        if (!timeElement || !timestamp) return;
        
        try {
            const date = new Date(timestamp);
            const timeString = date.toLocaleString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            timeElement.textContent = `Última atualização: ${timeString}`;
        } catch (error) {
            timeElement.textContent = 'Última atualização: Agora';
        }
    }
    
    startLiveUpdates() {
        if (this.isEnabled) return;
        
        this.isEnabled = true;
        this.updateStatus('connecting', 'Conectando...');
        
        // Buscar dados imediatamente
        this.updateLiveData();
        
        // Configurar timer para atualizações periódicas
        this.updateTimer = setInterval(() => {
            if (this.isEnabled) {
                this.updateLiveData();
            }
        }, this.updateInterval);
        
        // Atualizar botões
        this.updateButtons(true);
        
        // console.log('Dados ao vivo ativados');
    }
    
    stopLiveUpdates() {
        if (!this.isEnabled) return;
        
        this.isEnabled = false;
        this.updateStatus('disconnected', 'Desconectado');
        
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        
        // Atualizar botões
        this.updateButtons(false);
        
        console.log('Dados ao vivo desativados');
    }
    
    updateButtons(isEnabled) {
        const startBtn = document.getElementById('startLiveData');
        const stopBtn = document.getElementById('stopLiveData');
        
        if (startBtn) {
            startBtn.disabled = isEnabled;
        }
        
        if (stopBtn) {
            stopBtn.disabled = !isEnabled;
        }
    }
    
    async testConnection() {
        try {
            const response = await fetch(`${this.baseUrl}/health`);
            const data = await response.json();
            return data.status === 'ok';
        } catch (error) {
            return false;
        }
    }
}

// Instanciar o serviço
const marketDataService = new MarketDataService();

// Adicionar controles na interface
function addLiveDataControls() {
    const startBtn = document.getElementById('startLiveData');
    const stopBtn = document.getElementById('stopLiveData');
    
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            marketDataService.startLiveUpdates();
        });
    }
    
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            marketDataService.stopLiveUpdates();
        });
    }
    
    // Testar conexão na inicialização
    marketDataService.testConnection().then(isConnected => {
        if (isConnected) {
            console.log('Backend detectado e funcionando');
        } else {
            console.log('Backend não detectado - modo manual ativo');
        }
    });
}

// Adicionar estilos para inputs atualizados
function addLiveUpdateStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .live-updated {
            border-color: #22c55e !important;
            box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2) !important;
            animation: live-update-pulse 0.6s ease-out;
        }
        
        @keyframes live-update-pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
        }
        
        .live-updated::after {
            content: '🔄';
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 12px;
            animation: live-update-icon 1s ease-in-out;
        }
        
        @keyframes live-update-icon {
            0%, 100% { opacity: 0; }
            50% { opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

// Quotes Widget Service - Widget de Cotações Separado
class QuotesWidgetService {
    constructor() {
        this.baseUrl = 'http://localhost:5000/api';
        this.isUpdating = false;
    }
    
    async updateQuotes() {
        if (this.isUpdating) return;
        
        this.isUpdating = true;
        this.updateStatus('updating', 'Atualizando...');
        
        try {
            // Forçar atualização no backend
            await fetch(`${this.baseUrl}/update`);
            
            // Buscar dados atualizados
            const response = await fetch(`${this.baseUrl}/market-data`);
            const data = await response.json();
            
            if (data && data.status === 'success') {
                this.updateQuoteCards(data);
                this.updateStatus('success', 'Atualizado com sucesso');
                this.updateLastUpdateTime(data.timestamp);
            } else {
                this.updateStatus('error', 'Erro nos dados');
            }
        } catch (error) {
            console.error('Erro ao atualizar cotações:', error);
            this.updateStatus('error', 'Erro de conexão');
        } finally {
            this.isUpdating = false;
        }
    }
    
    updateQuoteCards(data) {
        console.log('🔄 Atualizando cards de cotações...', data);
        
        // Extrair dados da estrutura correta
        const marketData = data.data || data;
        console.log('📊 Dados extraídos:', marketData);
        
        // VIX
        if (marketData.vix && marketData.vix.current !== null && marketData.vix.variation !== null) {
            console.log('📊 Atualizando VIX:', marketData.vix);
            this.updateQuoteCard('vix', marketData.vix.current, marketData.vix.variation, marketData.vix.source);
        } else {
            console.log('⚠️ VIX sem dados válidos:', marketData.vix);
        }
        
        // Gold
        if (marketData.gold && marketData.gold.current !== null && marketData.gold.variation !== null) {
            console.log('📊 Atualizando Gold:', marketData.gold);
            this.updateQuoteCard('gold', marketData.gold.current, marketData.gold.variation, marketData.gold.source);
        } else {
            console.log('⚠️ Gold sem dados válidos:', marketData.gold);
        }
        
        // Iron Ore (VALE) - ADR com after-market
        if (marketData.iron && marketData.iron.current !== null && marketData.iron.variation !== null) {
            console.log('📊 Atualizando Iron:', marketData.iron);
            this.updateQuoteCard('iron', marketData.iron.current, marketData.iron.variation, marketData.iron.source, marketData.iron.has_after_market);
        } else {
            console.log('⚠️ Iron sem dados válidos:', marketData.iron);
        }
        
        // S&P 500
        if (marketData.macro && marketData.macro.sp500 && marketData.macro.sp500.current !== null && marketData.macro.sp500.variation !== null) {
            console.log('📊 Atualizando S&P500:', marketData.macro.sp500);
            this.updateQuoteCard('sp500', marketData.macro.sp500.current, marketData.macro.sp500.variation, marketData.macro.sp500.source);
        } else {
            console.log('⚠️ S&P500 sem dados válidos:', marketData.macro?.sp500);
        }
        
        // EWZ
        if (marketData.macro && marketData.macro.ewz && marketData.macro.ewz.current !== null && marketData.macro.ewz.variation !== null) {
            console.log('📊 Atualizando EWZ:', marketData.macro.ewz);
            this.updateQuoteCard('ewz', marketData.macro.ewz.current, marketData.macro.ewz.variation, marketData.macro.ewz.source);
        } else {
            console.log('⚠️ EWZ sem dados válidos:', marketData.macro?.ewz);
        }
        
        // Oil
        if (marketData.macro && marketData.macro.oil && marketData.macro.oil.current !== null && marketData.macro.oil.variation !== null) {
            console.log('📊 Atualizando Oil:', marketData.macro.oil);
            this.updateQuoteCard('oil', marketData.macro.oil.current, marketData.macro.oil.variation, marketData.macro.oil.source);
        } else {
            console.log('⚠️ Oil sem dados válidos:', marketData.macro?.oil);
        }
        
        // DXY
        if (marketData.macro && marketData.macro.dxy && marketData.macro.dxy.current !== null && marketData.macro.dxy.variation !== null) {
            console.log('📊 Atualizando DXY:', marketData.macro.dxy);
            this.updateQuoteCard('dxy', marketData.macro.dxy.current, marketData.macro.dxy.variation, marketData.macro.dxy.source);
        } else {
            console.log('⚠️ DXY sem dados válidos:', marketData.macro?.dxy);
        }
        
        // ADRs - Mostrar todos os ADRs disponíveis
        if (marketData.adrs) {
            console.log('📊 Processando ADRs:', marketData.adrs);
            
            // Mapear todos os ADRs para seus respectivos cards
            const adrMapping = {
                'VALE': 'vale',    // VALE agora no segundo grid
                'ITUB': 'itub',    // ADRs no segundo grid
                'PBR': 'pbr',
                'PBR-A': 'pbr-a',
                'BBD': 'bbd',
                'BBDO': 'bbdo',
                'ABEV': 'abev',
                'ERJ': 'erj'
            };
            
            Object.keys(adrMapping).forEach(ticker => {
                const adrData = marketData.adrs[ticker];
                if (adrData && adrData.current !== null) {
                    const cardId = adrMapping[ticker];
                    console.log(`📊 Atualizando ADR ${ticker} como ${cardId}:`, adrData);
                    this.updateQuoteCard(cardId, adrData.current, adrData.variation, adrData.source, adrData.has_after_market);
                }
            });
        }
    }
    
    updateQuoteCard(type, price, change, source = 'regular-market', hasAfterMarket = true) {
        console.log(`🔄 Atualizando card ${type}:`, { price, change, source, hasAfterMarket });
        
        const priceElement = document.getElementById(`${type}-price`);
        const changeElement = document.getElementById(`${type}-change`);
        const cardElement = document.getElementById(`quote-${type}`);
        
        console.log(`📊 Elementos encontrados:`, { 
            priceElement: !!priceElement, 
            changeElement: !!changeElement, 
            cardElement: !!cardElement 
        });
        
        if (priceElement) {
            if (price !== null && price !== undefined && !isNaN(price)) {
                const formattedPrice = price.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                });
                priceElement.textContent = formattedPrice;
                console.log(`✅ Preço ${type} atualizado:`, formattedPrice);
            } else {
                priceElement.textContent = '--';
                console.log(`⚠️ Preço ${type} inválido:`, price);
            }
        } else {
            console.log(`❌ Elemento de preço não encontrado: ${type}-price`);
        }
        
        if (changeElement) {
            if (change !== null && change !== undefined && !isNaN(change)) {
                const changeText = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
                
                // Adicionar indicador de fonte para ADRs
                if (type === 'iron' && source === 'after-hours' && hasAfterMarket) {
                    changeElement.textContent = `${changeText} 🕐`;
                } else {
                    changeElement.textContent = changeText;
                }
                
                // Remover classes anteriores
                changeElement.className = 'quote-change';
                
                // Adicionar classe apropriada - CORRIGIDO para todas as ADRs
                if (change > 0) {
                    changeElement.classList.add('positive');
                    console.log(`✅ Aplicando classe positive para ${type}: ${changeText}`);
                    console.log(`🔍 Classes após aplicação:`, changeElement.className);
                } else if (change < 0) {
                    changeElement.classList.add('negative');
                    console.log(`✅ Aplicando classe negative para ${type}: ${changeText}`);
                    console.log(`🔍 Classes após aplicação:`, changeElement.className);
                } else {
                    changeElement.classList.add('neutral');
                    console.log(`✅ Aplicando classe neutral para ${type}: ${changeText}`);
                    console.log(`🔍 Classes após aplicação:`, changeElement.className);
                }
                
                console.log(`✅ Variação ${type} atualizada:`, changeText);
            } else {
                changeElement.textContent = 'Sem dados';
                changeElement.className = 'quote-change no-data';
                console.log(`⚠️ Variação ${type} inválida:`, change);
            }
        } else {
            console.log(`❌ Elemento de variação não encontrado: ${type}-change`);
        }
        
        // Adicionar indicador visual de after-market no card
        if (cardElement) {
            if (type === 'iron' && source === 'after-hours' && hasAfterMarket) {
                cardElement.classList.add('after-hours');
            } else {
                cardElement.classList.remove('after-hours', 'no-after-market');
            }
            
            // Animação de atualização
            cardElement.classList.add('updated');
            setTimeout(() => {
                cardElement.classList.remove('updated');
            }, 600);
            
            console.log(`✅ Card ${type} atualizado com sucesso`);
        } else {
            console.log(`❌ Card não encontrado: quote-${type}`);
        }
    }
    
    updateStatus(status, text) {
        const statusElement = document.getElementById('quotesStatus');
        if (!statusElement) return;
        
        // Remover classes anteriores
        statusElement.className = 'quotes-status';
        
        // Adicionar nova classe
        statusElement.classList.add(status);
        
        // Atualizar texto
        const textElement = statusElement.querySelector('.status-text');
        if (textElement) {
            textElement.textContent = text;
        }
    }
    
    updateLastUpdateTime(timestamp) {
        const timeElement = document.getElementById('lastQuoteUpdate');
        if (!timeElement || !timestamp) return;
        
        try {
            const date = new Date(timestamp);
            const timeString = date.toLocaleString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            timeElement.textContent = timeString;
        } catch (error) {
            timeElement.textContent = 'Agora';
        }
    }
}

// Instanciar o serviço de cotações
const quotesWidgetService = new QuotesWidgetService();

// Adicionar controles do widget de cotações
function addQuotesWidgetControls() {
    const updateButton = document.getElementById('updateQuotes');
    
    if (updateButton) {
        updateButton.addEventListener('click', () => {
            quotesWidgetService.updateQuotes();
        });
    }
    
}


// ===== SERVIÇO DE PROJEÇÃO WINFUT =====
class WinfutProjectionService {
    constructor() {
        this.winfutData = null;
        this.calculatorVariation = 0;
        this.confidence = 0;
    }
    
    updateWinfutData(winfutData) {
        if (!winfutData) return;
        
        this.winfutData = winfutData;
        console.log('📊 Dados WINFUT recebidos:', winfutData);
        
        this.updateWinfutDisplay();
        this.calculateProjection();
    }
    
    updateWinfutDisplay() {
        // Não precisa mais atualizar automaticamente o fechamento
        // O usuário vai inserir manualmente
        console.log('🔄 WINFUT configurado para entrada manual');
        
        // Configurar evento para o campo de entrada
        const closingPriceInput = document.getElementById('winfut-closing-price');
        if (closingPriceInput) {
            // Remover event listeners anteriores para evitar duplicação
            closingPriceInput.removeEventListener('input', this.handleWinfutInput);
            
            // Adicionar novo event listener
            this.handleWinfutInput = () => {
                console.log('🔄 Campo WINFUT alterado - recalculando projeção');
                this.calculateProjection();
            };
            
            closingPriceInput.addEventListener('input', this.handleWinfutInput);
            console.log('✅ Event listener configurado para entrada manual');
        } else {
            console.warn('❌ Campo de entrada WINFUT não encontrado');
        }
    }
    
    updateCalculatorVariation(variation, confidence) {
        // Validar valores
        if (typeof variation !== 'number' || isNaN(variation)) {
            console.warn('⚠️ Variação inválida para WINFUT:', variation);
            return;
        }
        
        if (typeof confidence !== 'number' || isNaN(confidence)) {
            console.warn('⚠️ Confiança inválida para WINFUT:', confidence);
            return;
        }
        
        this.calculatorVariation = variation;
        this.confidence = confidence;
        
        console.log(`📈 Variação calculadora atualizada: ${variation.toFixed(2)}% (Confiança: ${confidence}%)`);
        
        this.updateVariationDisplay();
        this.calculateProjection();
    }
    
    updateVariationDisplay() {
        const percentageElement = document.getElementById('winfut-calculator-variation');
        const confidenceElement = document.getElementById('winfut-confidence');
        const descriptionElement = document.getElementById('winfut-description');
        
        if (percentageElement) {
            const percentageText = this.calculatorVariation >= 0 ? 
                `+${this.calculatorVariation.toFixed(2)}%` : 
                `${this.calculatorVariation.toFixed(2)}%`;
            percentageElement.textContent = percentageText;
            percentageElement.className = `winfut-percentage ${this.calculatorVariation >= 0 ? 'positive' : 'negative'}`;
        }
        
        if (confidenceElement) {
            confidenceElement.textContent = `${this.confidence}% Confiança`;
        }
        
        if (descriptionElement) {
            let description = '';
            if (this.calculatorVariation > 1.5) {
                description = 'Sinal forte de alta - ADRs e macro alinhados positivamente';
            } else if (this.calculatorVariation > 0.5) {
                description = 'Sinal moderado de alta - Tendência positiva';
            } else if (this.calculatorVariation > -0.5) {
                description = 'Sinal neutro - Mercado sem direção clara';
            } else if (this.calculatorVariation > -1.5) {
                description = 'Sinal moderado de baixa - Tendência negativa';
            } else {
                description = 'Sinal forte de baixa - ADRs e macro alinhados negativamente';
            }
            descriptionElement.textContent = description;
        }
    }
    
    calculateProjection() {
        if (this.calculatorVariation === 0) {
            console.log('⚠️ Variação da calculadora é zero - não calculando projeção');
            return;
        }
        
        // Obter preço de fechamento manual
        const closingPriceInput = document.getElementById('winfut-closing-price');
        const currentPrice = closingPriceInput ? parseFloat(closingPriceInput.value) : 0;
        
        console.log(`🔍 Debug WINFUT:`, {
            inputValue: closingPriceInput ? closingPriceInput.value : 'N/A',
            currentPrice: currentPrice,
            calculatorVariation: this.calculatorVariation,
            confidence: this.confidence
        });
        
        if (!currentPrice || currentPrice <= 0) {
            console.log('⚠️ Preço de fechamento WINFUT não inserido ou inválido');
            return;
        }
        
        const projectedPrice = currentPrice * (1 + this.calculatorVariation / 100);
        const pointsChange = projectedPrice - currentPrice;
        
        console.log(`🎯 Projeção WINFUT calculada:`, {
            fechamento: currentPrice,
            variacaoPercentual: this.calculatorVariation,
            projecao: projectedPrice,
            pontos: pointsChange,
            formula: `${currentPrice} × (1 + ${this.calculatorVariation}/100) = ${projectedPrice}`
        });
        
        this.updateProjectionDisplay(projectedPrice, pointsChange);
        this.generateRecommendation(projectedPrice, pointsChange);
    }
    
    updateProjectionDisplay(projectedPrice, pointsChange) {
        const projectionPriceElement = document.getElementById('winfut-projection-price');
        const pointsChangeElement = document.getElementById('winfut-points-change');
        const probabilityElement = document.getElementById('winfut-probability');
        
        if (projectionPriceElement) {
            // Mostrar com 1 casa decimal para maior precisão
            projectionPriceElement.textContent = projectedPrice.toFixed(1);
        }
        
        if (pointsChangeElement) {
            // Mostrar com 1 casa decimal para pontos
            const pointsText = pointsChange >= 0 ? 
                `+${pointsChange.toFixed(1)} pontos` : 
                `${pointsChange.toFixed(1)} pontos`;
            pointsChangeElement.textContent = pointsText;
            pointsChangeElement.className = `winfut-points-change ${pointsChange >= 0 ? 'positive' : 'negative'}`;
        }
        
        if (probabilityElement) {
            let probability = 50;
            if (this.confidence > 80) probability = 85;
            else if (this.confidence > 60) probability = 70;
            else if (this.confidence > 40) probability = 55;
            else probability = 45;
            
            probabilityElement.textContent = `${probability}% Probabilidade`;
        }
        
        console.log(`📊 Projeção atualizada: ${projectedPrice.toFixed(1)} (${pointsChange.toFixed(1)} pontos)`);
    }
    
    generateRecommendation(projectedPrice, pointsChange) {
        const recommendationElement = document.getElementById('winfut-recommendation-content');
        if (!recommendationElement) return;
        
        let recommendation = '';
        
        // ANÁLISE CRÍTICA DE DAYTRADE PROFISSIONAL
        const absChange = Math.abs(pointsChange);
        const isSignificantMove = absChange >= 30;
        const isStrongMove = absChange >= 80;
        
        if (absChange < 20) {
            // ZONA NEUTRA - Análise de suporte/resistência
            const supportZone = projectedPrice - 15;
            const resistanceZone = projectedPrice + 15;
            recommendation = `🟡 ZONA NEUTRA: WINFUT projetado para ${projectedPrice.toFixed(0)} pontos (±${absChange.toFixed(0)}). 
            📍 ZONA DE ATENÇÃO: ${projectedPrice.toFixed(0)} pontos pode atuar como:
            • Suporte se quebrar para baixo: entrada de compra
            • Resistência se quebrar para cima: entrada de venda
            🎯 Estratégia: Aguardar confirmação de rompimento ou operar ranges 15-20 pontos.`;
        } else if (pointsChange > 0) {
            if (isStrongMove) {
                recommendation = `🟢 TENDÊNCIA DE ALTA: WINFUT projetado para ${projectedPrice.toFixed(0)} pontos (+${pointsChange.toFixed(0)}). 
                📍 ZONA DE ATENÇÃO: ${projectedPrice.toFixed(0)} pontos como suporte dinâmico.
                🎯 Estratégia: Entrada na abertura com target +${Math.round(pointsChange * 0.8)} pontos e stop -${Math.round(pointsChange * 0.4)} pontos.
                ⚠️ Cuidado: Se quebrar ${projectedPrice.toFixed(0)} para baixo, pode virar resistência.`;
            } else {
                recommendation = `🟢 ALTA MODERADA: WINFUT projetado para ${projectedPrice.toFixed(0)} pontos (+${pointsChange.toFixed(0)}). 
                📍 ZONA DE ATENÇÃO: ${projectedPrice.toFixed(0)} pontos como nível de referência.
                🎯 Estratégia: Entrada gradual com target +${Math.round(pointsChange * 0.7)} pontos e stop -${Math.round(pointsChange * 0.5)} pontos.
                📊 Monitorar: Se manter acima de ${projectedPrice.toFixed(0)}, viés altista.`;
            }
        } else {
            if (isStrongMove) {
                recommendation = `🔴 TENDÊNCIA DE BAIXA: WINFUT projetado para ${projectedPrice.toFixed(0)} pontos (${pointsChange.toFixed(0)}). 
                📍 ZONA DE ATENÇÃO: ${projectedPrice.toFixed(0)} pontos como resistência dinâmica.
                🎯 Estratégia: Entrada na abertura com target ${Math.round(pointsChange * 0.8)} pontos e stop +${Math.round(Math.abs(pointsChange) * 0.4)} pontos.
                ⚠️ Cuidado: Se quebrar ${projectedPrice.toFixed(0)} para cima, pode virar suporte.`;
            } else {
                recommendation = `🔴 BAIXA MODERADA: WINFUT projetado para ${projectedPrice.toFixed(0)} pontos (${pointsChange.toFixed(0)}). 
                📍 ZONA DE ATENÇÃO: ${projectedPrice.toFixed(0)} pontos como nível de referência.
                🎯 Estratégia: Entrada gradual com target ${Math.round(pointsChange * 0.7)} pontos e stop +${Math.round(Math.abs(pointsChange) * 0.5)} pontos.
                📊 Monitorar: Se manter abaixo de ${projectedPrice.toFixed(0)}, viés baixista.`;
            }
        }
        
        recommendationElement.textContent = recommendation;
    }
}

// Instanciar o serviço de projeção WINFUT
const winfutProjectionService = new WinfutProjectionService();

// Inicializar controles
// ===== SISTEMA DE ABAS =====
function switchTab(tabName) {
    console.log(`🔄 Alternando para aba: ${tabName}`);
    
    // Remover classe ativa de todos os botões
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('tab-button--active');
    });
    
    // Remover classe ativa de todos os painéis
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('tab-panel--active');
    });
    
    // Ativar botão e painel correspondentes
    const activeButton = document.getElementById(`tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    const activePanel = document.getElementById(`${tabName}Tab`);
    
    if (activeButton) {
        activeButton.classList.add('tab-button--active');
    }
    
    if (activePanel) {
        activePanel.classList.add('tab-panel--active');
    }
    
    // Se for a aba da calculadora, atualizar cálculos
    if (tabName === 'calculator') {
        setTimeout(() => {
            updateAllCalculations();
        }, 100);
    }
    
    console.log(`✅ Aba ${tabName} ativada`);
}

// ===== BARRA LATERAL DE CONFIGURAÇÕES =====
function toggleSettings() {
    const sidebar = document.getElementById('settingsSidebar');
    const overlay = document.getElementById('settingsOverlay');
    const toggle = document.getElementById('settingsToggle');
    
    if (!sidebar || !overlay || !toggle) {
        console.error('❌ Elementos da barra lateral não encontrados');
        return;
    }
    
    const isOpen = sidebar.classList.contains('settings-sidebar--open');
    
    if (isOpen) {
        // Fechar barra lateral
        sidebar.classList.remove('settings-sidebar--open');
        overlay.classList.remove('settings-overlay--visible');
        toggle.style.transform = 'rotate(0deg)';
        document.body.style.overflow = 'auto';
        console.log('🔒 Configurações fechadas');
    } else {
        // Abrir barra lateral
        sidebar.classList.add('settings-sidebar--open');
        overlay.classList.add('settings-overlay--visible');
        toggle.style.transform = 'rotate(90deg)';
        document.body.style.overflow = 'hidden';
        console.log('⚙️ Configurações abertas');
    }
}

// Fechar configurações com ESC
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const sidebar = document.getElementById('settingsSidebar');
        if (sidebar && sidebar.classList.contains('settings-sidebar--open')) {
            toggleSettings();
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    addLiveDataControls();
    addLiveUpdateStyles();
    addQuotesWidgetControls();
    
    // Inicializar WINFUT
    console.log('🔄 Inicializando WINFUT...');
    winfutProjectionService.updateWinfutDisplay();
    
    // Garantir que a aba da calculadora esteja ativa por padrão
    switchTab('calculator');
});

// ============================================================================
// WINFUT ADVANCED PROJECTION - Sistema de Projeção Avançada (FASE 1)
// ============================================================================

/**
 * Calcula regiões dinâmicas para WINFUT baseadas no fechamento e projeção
 * INTEGRAÇÃO: Usa fechamento manual + projeção calculada
 */
function calculateAdvancedWinfutRegions(saldo, confidence, vixLevel) {
    console.log('🎯 Calculando regiões WINFUT baseadas em fechamento + projeção...');
    
    // 1. Obter fechamento WINFUT e projeção atual
    const winfutClosing = parseFloat(document.getElementById('winfut-closing-price')?.value) || 0;
    const winfutProjection = parseFloat(document.getElementById('winfut-projection-price')?.textContent?.replace(/[^\d.-]/g, '')) || 0;
    
    console.log('📊 Valores WINFUT:', { winfutClosing, winfutProjection, saldo });
    
    // 2. Verificar se há dados válidos
    if (winfutClosing <= 0 && winfutProjection <= 0) {
        console.log('⚠️ Nenhum valor WINFUT válido encontrado');
        return null; // Não calcular se não há dados
    }
    
    // 3. Calcular valor base (média entre fechamento e projeção)
    const baseValue = winfutClosing > 0 && winfutProjection > 0 ? 
        (winfutClosing + winfutProjection) / 2 : 
        (winfutClosing || winfutProjection);
    
    // 3. Determinar regime baseado no VIX
    let regime = 'normal';
    let volatilityMultiplier = 1.0;
    
    if (vixLevel < 15) {
        regime = 'calm';
        volatilityMultiplier = 0.8;
    } else if (vixLevel > 35) {
        regime = 'extreme';
        volatilityMultiplier = 1.5;
    } else if (vixLevel > 25) {
        regime = 'volatile';
        volatilityMultiplier = 1.2;
    }
    
    // 4. Calcular multiplicador temporal
    const hour = new Date().getHours();
    let timeMultiplier = 1.0;
    
    if (hour >= 17 && hour <= 21) timeMultiplier = 0.8; // After-hours
    else if (hour >= 5 && hour <= 10) timeMultiplier = 1.2; // Pre-market
    else if (hour < 5 || hour > 21) timeMultiplier = 0.6; // Overnight
    
    // 5. Gerar 3 regiões baseadas nos parâmetros reais do WINFUT
    let optimisticMultiplier, pessimisticMultiplier;
    
    // Ajustar multiplicadores baseado no regime de volatilidade
    if (regime === 'calm') {
        optimisticMultiplier = 1.004; // +0.4% (movimento calmo)
        pessimisticMultiplier = 0.996; // -0.4%
    } else if (regime === 'volatile') {
        optimisticMultiplier = 1.015; // +1.5% (movimento volátil)
        pessimisticMultiplier = 0.985; // -1.5%
    } else if (regime === 'extreme') {
        optimisticMultiplier = 1.020; // +2.0% (movimento extremo)
        pessimisticMultiplier = 0.980; // -2.0%
    } else { // normal
        optimisticMultiplier = 1.010; // +1.0% (movimento normal)
        pessimisticMultiplier = 0.990; // -1.0%
    }
    
    const regions = {
        optimistic: {
            center: baseValue * optimisticMultiplier,
            probability: 0.28,
            confidence: confidence * 0.9,
            description: 'Alvos Agressivos - Resistência',
            icon: '🚀'
        },
        central: {
            center: baseValue, // Valor base (fechamento + projeção) / 2
            probability: 0.45,
            confidence: confidence,
            description: 'Estratégia Principal - Suporte',
            icon: '🎯'
        },
        pessimistic: {
            center: baseValue * pessimisticMultiplier,
            probability: 0.27,
            confidence: confidence * 0.8,
            description: 'Hedge e Proteção - Suporte Forte',
            icon: '🛡️'
        }
    };
    
    // 6. Aplicar volatilidade do regime para criar faixas
    Object.keys(regions).forEach(key => {
        const region = regions[key];
        const volatility = volatilityMultiplier * 0.015; // 1.5% base
        
        region.lowerBound = region.center - (region.center * volatility);
        region.upperBound = region.center + (region.center * volatility);
        region.volatility = volatilityMultiplier;
    });
    
    console.log('✅ Regiões WINFUT calculadas:', {
        regime,
        timeMultiplier,
        baseValue,
        regions: Object.keys(regions).map(k => ({
            name: k,
            center: regions[k].center.toFixed(0),
            probability: (regions[k].probability * 100).toFixed(0) + '%'
        }))
    });
    
    return {
        regions,
        regime,
        timeMultiplier,
        volatilityMultiplier,
        baseValue
    };
}

/**
 * Atualiza projeção WINFUT com regiões dinâmicas
 * IMPLEMENTAÇÃO SEGURA: Hook opcional no sistema existente
 */
function updateAdvancedWinfutProjection(saldo, confidence) {
    console.log('🔄 Atualizando projeção WINFUT avançada...');
    
    const vixLevel = appState.vixData.absolute || 20;
    const advancedData = calculateAdvancedWinfutRegions(saldo, confidence, vixLevel);
    
    // Verificar se há dados válidos antes de renderizar
    if (advancedData && advancedData.regions) {
        // Renderizar na interface visual
        renderAdvancedWinfutInterface(advancedData);
        
        // Logs para debug
        console.log('📊 PROJEÇÃO WINFUT AVANÇADA:', {
            regime: advancedData.regime,
            timeMultiplier: advancedData.timeMultiplier,
            regions: {
                otimista: `${advancedData.regions.optimistic.center.toFixed(1)} (${(advancedData.regions.optimistic.probability * 100).toFixed(0)}%)`,
                central: `${advancedData.regions.central.center.toFixed(1)} (${(advancedData.regions.central.probability * 100).toFixed(0)}%)`,
                pessimista: `${advancedData.regions.pessimistic.center.toFixed(1)} (${(advancedData.regions.pessimistic.probability * 100).toFixed(0)}%)`
            }
        });
    } else {
        console.log('⚠️ Sem dados válidos para renderizar regiões WINFUT');
        // Limpar interface se não há dados válidos
        const container = document.getElementById('winfut-regions-container');
        if (container) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: #6c757d; font-size: 14px;">Digite o fechamento WINFUT para ver as regiões de projeção</div>';
        }
    }
    
    return advancedData;
}

/**
 * Renderiza regiões dinâmicas integradas na seção WINFUT
 */
function renderAdvancedWinfutInterface(data) {
    console.log('🎨 Integrando regiões dinâmicas na seção WINFUT...');
    
    const container = document.getElementById('winfut-regions-container');
    if (!container) {
        console.warn('⚠️ Container winfut-regions-container não encontrado');
        return;
    }

    console.log('✅ Container WINFUT encontrado:', container);
    const { regions, regime, timeMultiplier } = data;
    
    console.log('📊 Dados recebidos:', {
        regime,
        timeMultiplier,
        regions: {
            optimistic: regions.optimistic.center,
            central: regions.central.center,
            pessimistic: regions.pessimistic.center
        }
    });
    
    container.innerHTML = `
        <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-top: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h5 style="margin: 0; color: #495057; font-size: 16px; font-weight: 600;">🎯 Regiões de Projeção WINFUT</h5>
                <div style="display: flex; gap: 8px;">
                    <span style="background: #007bff; color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">${regime.toUpperCase()}</span>
                    <span style="background: #6c757d; color: white; padding: 2px 6px; border-radius: 8px; font-size: 11px;">${timeMultiplier.toFixed(1)}x</span>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                <div style="background: #d4edda; border: 1px solid #28a745; border-radius: 6px; padding: 12px; text-align: center;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 16px;">🚀</span>
                        <span style="background: #28a745; color: white; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600;">${(regions.optimistic.probability * 100).toFixed(0)}%</span>
                    </div>
                    <div style="font-size: 16px; font-weight: 700; color: #155724; margin-bottom: 4px;">${regions.optimistic.center.toFixed(0)}</div>
                    <div style="font-size: 9px; color: #155724; margin-bottom: 2px;">Resistência</div>
                    <div style="font-size: 8px; color: #155724; opacity: 0.8;">${regions.optimistic.lowerBound.toFixed(0)}-${regions.optimistic.upperBound.toFixed(0)}</div>
                </div>
                
                <div style="background: #cce5ff; border: 2px solid #007bff; border-radius: 6px; padding: 12px; text-align: center; transform: scale(1.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 16px;">🎯</span>
                        <span style="background: #007bff; color: white; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600;">${(regions.central.probability * 100).toFixed(0)}%</span>
                    </div>
                    <div style="font-size: 18px; font-weight: 700; color: #004085; margin-bottom: 4px;">${regions.central.center.toFixed(0)}</div>
                    <div style="font-size: 9px; color: #004085; margin-bottom: 2px;">Suporte</div>
                    <div style="font-size: 8px; color: #004085; opacity: 0.8;">${regions.central.lowerBound.toFixed(0)}-${regions.central.upperBound.toFixed(0)}</div>
                </div>
                
                <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px; text-align: center;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-size: 16px;">🛡️</span>
                        <span style="background: #ffc107; color: #856404; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600;">${(regions.pessimistic.probability * 100).toFixed(0)}%</span>
                    </div>
                    <div style="font-size: 16px; font-weight: 700; color: #856404; margin-bottom: 4px;">${regions.pessimistic.center.toFixed(0)}</div>
                    <div style="font-size: 9px; color: #856404; margin-bottom: 2px;">Suporte Forte</div>
                    <div style="font-size: 8px; color: #856404; opacity: 0.8;">${regions.pessimistic.lowerBound.toFixed(0)}-${regions.pessimistic.upperBound.toFixed(0)}</div>
                </div>
            </div>
            
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #dee2e6; text-align: center;">
                <div style="font-size: 11px; color: #6c757d;">
                    Base: ${data.baseValue?.toFixed(0) || 'N/A'} | Fechamento: ${parseFloat(document.getElementById('winfut-closing-price')?.value || 0).toFixed(0)} | Projeção: ${parseFloat(document.getElementById('winfut-projection-price')?.textContent?.replace(/[^\d.-]/g, '') || 0).toFixed(0)}
                </div>
            </div>
        </div>
    `;
    
    console.log('🎨 Interface visual das regiões renderizada');
    console.log('🔍 HTML inserido:', container.innerHTML.substring(0, 200) + '...');
}
