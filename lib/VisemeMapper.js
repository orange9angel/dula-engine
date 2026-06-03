/**
 * VisemeMapper -- 中文文本 -> Viseme 视位序列映射
 *
 * 将台词文本转换为嘴型动画序列，无需音频分析。
 * 基于中文字符到拼音韵母的简化映射，覆盖高频常用字。
 */

// ===== 高频中文字符 -> Viseme 映射 =====
const CHAR_TO_VISEME = {
  // === A 韵母（啊音系）===
  '啊': 'A', '阿': 'A', '大': 'A', '他': 'A', '她': 'A', '它': 'A',
  '那': 'A', '哪': 'A', '打': 'A', '法': 'A', '发': 'A', '家': 'A',
  '加': 'A', '假': 'A', '价': 'A', '下': 'A', '夏': 'A', '吓': 'A',
  '话': 'A', '化': 'A', '华': 'A', '花': 'A', '画': 'A', '划': 'A',
  '查': 'A', '茶': 'A', '差': 'A', '沙': 'A', '杀': 'A', '啥': 'A',
  '马': 'A', '妈': 'A', '麻': 'A', '骂': 'A', '码': 'A', '吗': 'A',
  '拿': 'A', '拉': 'A', '啦': 'A', '辣': 'A', '哈': 'A', '卡': 'A',
  '怕': 'A', '爬': 'A', '趴': 'A', '八': 'A', '巴': 'A', '把': 'A',
  '爸': 'A', '吧': 'A', '罢': 'A', '搭': 'A', '答': 'A', '达': 'A',
  '塔': 'A', '踏': 'A', '塌': 'A', '炸': 'A', '诈': 'A', '榨': 'A',
  '渣': 'A', '扎': 'A', '插': 'A', '叉': 'A', '察': 'A', '擦': 'A',
  '晒': 'A', '洒': 'A', '萨': 'A', '傻': 'A', '厦': 'A',
  '在': 'A', '再': 'A', '载': 'A', '灾': 'A', '宰': 'A', '寨': 'A',
  '才': 'A', '材': 'A', '财': 'A', '裁': 'A', '采': 'A', '彩': 'A',
  '菜': 'A', '踩': 'A', '蔡': 'A', '赛': 'A', '塞': 'A', '腮': 'A',
  '爱': 'A', '艾': 'A', '挨': 'A', '矮': 'A', '唉': 'A',
  '太': 'A', '台': 'A', '泰': 'A', '态': 'A', '胎': 'A',
  '开': 'A', '凯': 'A', '慨': 'A', '楷': 'A',
  '海': 'A', '还': 'A', '害': 'A', '孩': 'A', '亥': 'A',
  '来': 'A', '莱': 'A', '赖': 'A', '睐': 'A',
  '白': 'A', '百': 'A', '摆': 'A', '败': 'A', '拜': 'A', '伯': 'A',
  '派': 'A', '排': 'A', '牌': 'A', '徘': 'A',
  '买': 'A', '卖': 'A', '麦': 'A', '脉': 'A',
  '代': 'A', '带': 'A', '待': 'A', '戴': 'A', '袋': 'A', '贷': 'A',
  '耐': 'A', '奈': 'A', '兰': 'A', '蓝': 'A', '栏': 'A', '烂': 'A', '懒': 'A',
  '干': 'A', '感': 'A', '敢': 'A', '赶': 'A', '甘': 'A', '肝': 'A',
  '安': 'A', '按': 'A', '暗': 'A', '案': 'A',
  '般': 'A', '班': 'A', '搬': 'A', '半': 'A', '伴': 'A', '办': 'A',
  '盘': 'A', '判': 'A', '盼': 'A', '畔': 'A',
  '满': 'A', '慢': 'A', '漫': 'A', '曼': 'A', '蛮': 'A',
  '反': 'A', '饭': 'A', '范': 'A', '犯': 'A', '泛': 'A',
  '谈': 'A', '弹': 'A', '谭': 'A', '坛': 'A', '坦': 'A',
  '难': 'A', '南': 'A', '男': 'A', '楠': 'A',
  '然': 'A', '燃': 'A', '染': 'A', '让': 'A', '嚷': 'A',
  '向': 'A', '象': 'A', '项': 'A', '相': 'A', '香': 'A', '想': 'A',
  '长': 'A', '场': 'A', '常': 'A', '尝': 'A', '偿': 'A', '畅': 'A',
  '上': 'A', '伤': 'A', '商': 'A', '赏': 'A', '尚': 'A',
  '刚': 'A', '钢': 'A', '岗': 'A', '港': 'A', '杠': 'A',
  '康': 'A', '抗': 'A', '炕': 'A', '忙': 'A', '盲': 'A', '芒': 'A', '茫': 'A',
  '方': 'A', '放': 'A', '房': 'A', '防': 'A', '访': 'A', '仿': 'A',
  '当': 'A', '党': 'A', '挡': 'A', '荡': 'A', '档': 'A',
  '汤': 'A', '唐': 'A', '堂': 'A', '糖': 'A', '塘': 'A', '躺': 'A',
  '狼': 'A', '浪': 'A', '郎': 'A', '朗': 'A', '桑': 'A', '丧': 'A',
  '帮': 'A', '邦': 'A', '榜': 'A', '膀': 'A', '傍': 'A', '棒': 'A',
  '旁': 'A', '庞': 'A', '胖': 'A', '乓': 'A',
  '脏': 'A', '葬': 'A', '藏': 'A', '张': 'A', '章': 'A', '彰': 'A',
  '掌': 'A', '涨': 'A', '丈': 'A', '昌': 'A', '唱': 'A', '倡': 'A',
  '光': 'A', '广': 'A', '逛': 'A', '狂': 'A', '况': 'A', '矿': 'A', '框': 'A',
  '黄': 'A', '皇': 'A', '荒': 'A', '慌': 'A', '煌': 'A',
  '王': 'A', '望': 'A', '忘': 'A', '妄': 'A', '汪': 'A', '旺': 'A',
  '双': 'A', '爽': 'A', '装': 'A', '状': 'A', '壮': 'A', '撞': 'A',
  '窗': 'A', '床': 'A', '创': 'A', '闯': 'A', '疮': 'A',
  '刷': 'A', '耍': 'A', '抓': 'A', '爪': 'A', '摔': 'A', '甩': 'A',
  '帅': 'A', '率': 'A', '怪': 'A', '乖': 'A', '快': 'A', '块': 'A', '筷': 'A',
  '怀': 'A', '坏': 'A', '淮': 'A', '外': 'A', '歪': 'A', '衰': 'A',
  // === I 韵母（衣音系）===
  '一': 'I', '以': 'I', '已': 'I', '意': 'I', '义': 'I', '议': 'I',
  '易': 'I', '衣': 'I', '依': 'I', '医': 'I', '移': 'I', '遗': 'I',
  '疑': 'I', '宜': 'I', '仪': 'I', '乙': 'I', '亿': 'I', '艺': 'I',
  '是': 'I', '时': 'I', '十': 'I', '事': 'I', '实': 'I', '使': 'I',
  '市': 'I', '式': 'I', '士': 'I', '师': 'I', '试': 'I', '识': 'I',
  '石': 'I', '史': 'I', '丝': 'I', '死': 'I', '四': 'I', '思': 'I',
  '司': 'I', '私': 'I', '斯': 'I', '撕': 'I', '似': 'I',
  '你': 'I', '尼': 'I', '泥': 'I', '逆': 'I', '腻': 'I',
  '里': 'I', '理': 'I', '力': 'I', '利': 'I', '立': 'I', '历': 'I',
  '李': 'I', '丽': 'I', '例': 'I', '礼': 'I', '粒': 'I', '厉': 'I',
  '第': 'I', '帝': 'I', '弟': 'I', '递': 'I', '蒂': 'I',
  '地': 'I', '低': 'I', '底': 'I', '抵': 'I',
  '体': 'I', '替': 'I', '题': 'I', '提': 'I', '梯': 'I', '啼': 'I',
  '期': 'I', '七': 'I', '起': 'I', '气': 'I', '器': 'I', '汽': 'I',
  '齐': 'I', '奇': 'I', '骑': 'I', '棋': 'I', '旗': 'I',
  '机': 'I', '几': 'I', '己': 'I', '计': 'I', '记': 'I', '技': 'I',
  '基': 'I', '济': 'I', '级': 'I', '极': 'I', '急': 'I', '集': 'I',
  '及': 'I', '即': 'I', '既': 'I', '继': 'I', '季': 'I', '寄': 'I',
  '系': 'I', '戏': 'I', '细': 'I', '喜': 'I', '希': 'I', '息': 'I',
  '西': 'I', '吸': 'I', '习': 'I', '席': 'I', '袭': 'I',
  '比': 'I', '必': 'I', '毕': 'I', '笔': 'I', '避': 'I', '壁': 'I',
  '鼻': 'I', '彼': 'I', '皮': 'I', '批': 'I', '匹': 'I', '疲': 'I', '脾': 'I',
  '米': 'I', '密': 'I', '秘': 'I', '蜜': 'I', '迷': 'I', '谜': 'I',
  '弥': 'I', '敌': 'I', '滴': 'I', '迪': 'I', '笛': 'I', '嫡': 'I',
  '踢': 'I', '离': 'I', '黎': 'I', '莉': 'I',
  '鸡': 'I', '激': 'I', '积': 'I', '绩': 'I', '击': 'I',
  '妻': 'I', '七': 'I', '凄': 'I', '柒': 'I', '其': 'I',
  '洗': 'I', '字': 'I', '子': 'I', '自': 'I', '资': 'I', '姿': 'I', '紫': 'I',
  '此': 'I', '次': 'I', '词': 'I', '辞': 'I', '刺': 'I', '慈': 'I',
  '之': 'I', '只': 'I', '支': 'I', '知': 'I', '止': 'I', '至': 'I',
  '制': 'I', '治': 'I', '志': 'I', '致': 'I', '置': 'I', '智': 'I',
  '吃': 'I', '持': 'I', '池': 'I', '迟': 'I', '尺': 'I', '齿': 'I',
  '日': 'I', '入': 'I', '如': 'I', '若': 'I', '弱': 'I', '肉': 'I',
  '女': 'I', '努': 'I', '怒': 'I', '奴': 'I',
  '旅': 'I', '律': 'I', '虑': 'I', '绿': 'I', '驴': 'I',
  '居': 'I', '局': 'I', '举': 'I', '巨': 'I', '具': 'I', '距': 'I',
  '句': 'I', '拒': 'I', '剧': 'I', '据': 'I',
  '需': 'I', '须': 'I', '虚': 'I', '许': 'I', '续': 'I', '序': 'I',
  '鱼': 'I', '雨': 'I', '语': 'I', '余': 'I', '予': 'I', '宇': 'I',
  '遇': 'I', '玉': 'I', '育': 'I', '欲': 'I', '愈': 'I',
  '区': 'I', '曲': 'I', '取': 'I', '去': 'I', '趣': 'I', '驱': 'I',
  '菊': 'I', '橘': 'I',

  // === U 韵母（乌音系）===
  '不': 'U', '部': 'U', '步': 'U', '布': 'U', '补': 'U', '捕': 'U',
  '无': 'U', '五': 'U', '物': 'U', '务': 'U', '武': 'U', '舞': 'U',
  '屋': 'U', '乌': 'U', '污': 'U', '巫': 'U', '呜': 'U', '吾': 'U',
  '母': 'U', '木': 'U', '目': 'U', '牧': 'U', '墓': 'U', '幕': 'U',
  '穆': 'U', '暮': 'U', '募': 'U', '慕': 'U',
  '路': 'U', '陆': 'U', '录': 'U', '露': 'U', '炉': 'U', '卢': 'U',
  '鲁': 'U', '鹿': 'U', '禄': 'U', '古': 'U', '股': 'U', '骨': 'U',
  '鼓': 'U', '谷': 'U', '固': 'U', '故': 'U', '顾': 'U', '雇': 'U',
  '苦': 'U', '库': 'U', '裤': 'U', '酷': 'U',
  '胡': 'U', '湖': 'U', '户': 'U', '互': 'U', '呼': 'U', '忽': 'U',
  '虎': 'U', '狐': 'U', '壶': 'U', '蝴': 'U', '糊': 'U',
  '都': 'U', '读': 'U', '独': 'U', '毒': 'U', '堵': 'U', '赌': 'U',
  '度': 'U', '渡': 'U', '肚': 'U', '杜': 'U',
  '土': 'U', '图': 'U', '突': 'U', '途': 'U', '徒': 'U', '涂': 'U',
  '兔': 'U', '吐': 'U', '苏': 'U', '速': 'U', '素': 'U', '塑': 'U',
  '宿': 'U', '诉': 'U', '足': 'U', '族': 'U', '祖': 'U', '阻': 'U',
  '组': 'U', '租': 'U', '粗': 'U', '促': 'U', '醋': 'U',
  '初': 'U', '除': 'U', '楚': 'U', '础': 'U', '触': 'U', '处': 'U',
  '书': 'U', '树': 'U', '数': 'U', '术': 'U', '束': 'U', '述': 'U',
  '属': 'U', '暑': 'U', '鼠': 'U', '薯': 'U',
  '入': 'U', '如': 'U', '汝': 'U', '乳': 'U', '辱': 'U',
  '服': 'U', '福': 'U', '负': 'U', '付': 'U', '夫': 'U', '府': 'U',
  '富': 'U', '父': 'U', '妇': 'U', '附': 'U', '复': 'U', '覆': 'U',
  '佛': 'U', '否': 'U', '浮': 'U', '符': 'U', '伏': 'U', '俘': 'U',
  '勿': 'U', '误': 'U', '雾': 'U', '悟': 'U', '侮': 'U', '伍': 'U', '坞': 'U',
  '六': 'U', '牛': 'U', '扭': 'U', '纽': 'U', '浓': 'U', '农': 'U',
  '龙': 'U', '隆': 'U', '笼': 'U', '拢': 'U', '聋': 'U', '垄': 'U',
  '工': 'U', '公': 'U', '功': 'U', '共': 'U', '攻': 'U', '宫': 'U',
  '恭': 'U', '供': 'U', '贡': 'U', '巩': 'U', '汞': 'U',
  '空': 'U', '孔': 'U', '恐': 'U', '控': 'U',
  '红': 'U', '宏': 'U', '洪': 'U', '虹': 'U', '鸿': 'U', '哄': 'U',
  '同': 'U', '通': 'U', '痛': 'U', '童': 'U', '统': 'U', '桶': 'U',
  '动': 'U', '东': 'U', '冬': 'U', '懂': 'U', '董': 'U', '洞': 'U',
  '弄': 'U', '中': 'U', '种': 'U', '重': 'U', '众': 'U', '终': 'U',
  '钟': 'U', '忠': 'U', '仲': 'U', '肿': 'U', '舟': 'U', '州': 'U',
  '洲': 'U', '容': 'U', '融': 'U', '荣': 'U', '绒': 'U', '熔': 'U',
  '溶': 'U', '从': 'U', '丛': 'U', '匆': 'U', '葱': 'U', '聪': 'U',
  '松': 'U', '送': 'U', '宋': 'U', '颂': 'U', '诵': 'U', '耸': 'U',
  '总': 'U', '宗': 'U', '纵': 'U', '踪': 'U', '粽': 'U',
  '用': 'U', '永': 'U', '勇': 'U', '涌': 'U', '泳': 'U', '咏': 'U',
  '穷': 'U', '琼': 'U', '穹': 'U', '兄': 'U', '凶': 'U', '胸': 'U',
  '雄': 'U', '熊': 'U', '多': 'U', '朵': 'U', '躲': 'U', '夺': 'U',
  '舵': 'U', '罗': 'U', '落': 'U', '络': 'U', '骆': 'U', '螺': 'U',
  '萝': 'U', '左': 'U', '佐': 'U', '坐': 'U', '座': 'U', '做': 'U',
  '作': 'U', '昨': 'U', '所': 'U', '索': 'U', '锁': 'U', '缩': 'U',
  '火': 'U', '或': 'U', '货': 'U', '获': 'U', '祸': 'U', '惑': 'U',
  '霍': 'U', '豁': 'U', '果': 'U', '过': 'U', '国': 'U', '郭': 'U',
  '锅': 'U', '裹': 'U', '波': 'U', '博': 'U', '伯': 'U', '薄': 'U',
  '搏': 'U', '勃': 'U', '破': 'U', '坡': 'U', '婆': 'U', '迫': 'U',
  '魄': 'U', '磨': 'U', '魔': 'U', '末': 'U', '莫': 'U', '漠': 'U',
  '墨': 'U', '默': 'U', '陌': 'U', '沫': 'U', '没': 'U',
  '我': 'U', '握': 'U', '卧': 'U', '沃': 'U', '蜗': 'U',
  '哦': 'U', '偶': 'U', '藕': 'U', '某': 'U', '谋': 'U', '牟': 'U',
  '眸': 'U', '缪': 'U', '缶': 'U', '搜': 'U', '艘': 'U', '叟': 'U',
  '擞': 'U', '周': 'U', '舟': 'U', '粥': 'U', '轴': 'U', '宙': 'U',
  '昼': 'U', '皱': 'U', '骤': 'U', '抽': 'U', '愁': 'U', '仇': 'U',
  '筹': 'U', '酬': 'U', '绸': 'U', '臭': 'U', '丑': 'U',
  '收': 'U', '手': 'U', '首': 'U', '守': 'U', '寿': 'U', '兽': 'U',
  '受': 'U', '授': 'U', '售': 'U', '瘦': 'U', '柔': 'U', '揉': 'U',
  '蹂': 'U', '鞣': 'U', '豆': 'U', '斗': 'U', '抖': 'U', '陡': 'U',
  '逗': 'U', '痘': 'U', '头': 'U', '投': 'U', '透': 'U', '偷': 'U',
  '楼': 'U', '漏': 'U', '陋': 'U', '娄': 'U', '搂': 'U',
  '走': 'U', '奏': 'U', '揍': 'U', '够': 'U', '购': 'U', '构': 'U',
  '沟': 'U', '钩': 'U', '狗': 'U', '口': 'U', '扣': 'U', '寇': 'U',
  '抠': 'U', '后': 'U', '候': 'U', '厚': 'U', '猴': 'U',
  '欧': 'U', '殴': 'U', '鸥': 'U', '有': 'U', '又': 'U', '右': 'U',
  '友': 'U', '油': 'U', '游': 'U', '由': 'U', '邮': 'U', '犹': 'U',
  '尤': 'U', '幼': 'U', '诱': 'U', '就': 'U', '旧': 'U', '救': 'U',
  '舅': 'U', '究': 'U', '九': 'U', '久': 'U', '酒': 'U', '玖': 'U',
  '灸': 'U', '修': 'U', '休': 'U', '秀': 'U', '袖': 'U', '锈': 'U',
  '羞': 'U', '朽': 'U', '求': 'U', '球': 'U', '秋': 'U', '丘': 'U',
  '囚': 'U', '蚯': 'U',
  // === E 韵母（厄音系）===
  '的': 'E', '得': 'E', '德': 'E', '了': 'E', '乐': 'E', '勒': 'E',
  '雷': 'E', '累': 'E', '泪': 'E', '类': 'E', '个': 'E', '各': 'E',
  '格': 'E', '革': 'E', '隔': 'E', '阁': 'E', '哥': 'E', '歌': 'E',
  '戈': 'E', '鸽': 'E', '搁': 'E', '可': 'E', '科': 'E', '克': 'E',
  '刻': 'E', '客': 'E', '课': 'E', '柯': 'E', '棵': 'E', '颗': 'E',
  '壳': 'E', '和': 'E', '合': 'E', '何': 'E', '河': 'E', '贺': 'E',
  '荷': 'E', '核': 'E', '盒': 'E', '禾': 'E', '赫': 'E',
  '着': 'E', '者': 'E', '这': 'E', '遮': 'E', '哲': 'E', '浙': 'E',
  '车': 'E', '彻': 'E', '撤': 'E', '扯': 'E', '澈': 'E', '热': 'E',
  '惹': 'E', '色': 'E', '塞': 'E', '瑟': 'E', '涩': 'E', '特': 'E',
  '忑': 'E', '呢': 'E', '讷': 'E', '内': 'E', '馁': 'E', '给': 'E',
  '黑': 'E', '嘿': 'E', '非': 'E', '飞': 'E', '费': 'E', '肥': 'E',
  '废': 'E', '妃': 'E', '匪': 'E', '诽': 'E', '吠': 'E',
  '每': 'E', '美': 'E', '妹': 'E', '梅': 'E', '媒': 'E', '枚': 'E',
  '霉': 'E', '昧': 'E', '为': 'E', '位': 'E', '委': 'E', '威': 'E',
  '微': 'E', '危': 'E', '唯': 'E', '维': 'E', '伟': 'E', '卫': 'E',
  '未': 'E', '味': 'E', '慰': 'E', '魏': 'E', '畏': 'E', '胃': 'E',
  '谓': 'E', '谁': 'E', '水': 'E', '睡': 'E', '税': 'E', '顺': 'E',
  '瞬': 'E', '本': 'E', '笨': 'E', '奔': 'E', '崩': 'E', '绷': 'E',
  '甭': 'E', '盆': 'E', '朋': 'E', '鹏': 'E', '碰': 'E', '捧': 'E',
  '砰': 'E', '门': 'E', '们': 'E', '闷': 'E', '盟': 'E', '梦': 'E',
  '孟': 'E', '猛': 'E', '蒙': 'E', '朦': 'E', '分': 'E', '份': 'E',
  '纷': 'E', '粉': 'E', '奋': 'E', '愤': 'E', '坟': 'E', '焚': 'E',
  '人': 'E', '任': 'E', '认': 'E', '仁': 'E', '忍': 'E', '刃': 'E',
  '韧': 'E', '纫': 'E', '饪': 'E', '真': 'E', '正': 'E', '整': 'E',
  '争': 'E', '证': 'E', '政': 'E', '征': 'E', '郑': 'E', '症': 'E',
  '睁': 'E', '筝': 'E', '身': 'E', '深': 'E', '神': 'E', '申': 'E',
  '审': 'E', '伸': 'E', '甚': 'E', '渗': 'E', '慎': 'E',
  '更': 'E', '耕': 'E', '耿': 'E', '梗': 'E', '成': 'E', '城': 'E',
  '程': 'E', '承': 'E', '诚': 'E', '惩': 'E', '呈': 'E', '澄': 'E',
  '橙': 'E', '声': 'E', '生': 'E', '升': 'E', '胜': 'E', '圣': 'E',
  '剩': 'E', '绳': 'E', '牲': 'E', '能': 'E', '冷': 'E', '愣': 'E',
  '棱': 'E', '楞': 'E', '等': 'E', '登': 'E', '灯': 'E', '瞪': 'E',
  '蹬': 'E', '凳': 'E', '疼': 'E', '藤': 'E', '腾': 'E', '誊': 'E',
  '曾': 'E', '层': 'E', '蹭': 'E', '风': 'E', '丰': 'E', '封': 'E',
  '峰': 'E', '锋': 'E', '疯': 'E', '冯': 'E', '逢': 'E', '缝': 'E',
  '讽': 'E', '奉': 'E', '横': 'E', '衡': 'E', '恒': 'E', '亨': 'E',
  '哼': 'E', '增': 'E', '赠': 'E', '憎': 'E', '锃': 'E', '仍': 'E',
  '扔': 'E', '而': 'E', '儿': 'E', '耳': 'E', '二': 'E', '尔': 'E',
  '饵': 'E', '且': 'E', '切': 'E', '窃': 'E', '怯': 'E', '惬': 'E',
  '社': 'E', '设': 'E', '射': 'E', '舍': 'E', '涉': 'E', '赦': 'E',
  '蛇': 'E', '奢': 'E', '什': 'E', '额': 'E', '俄': 'E', '饿': 'E',
  '恶': 'E', '厄': 'E', '扼': 'E', '鹅': 'E', '娥': 'E', '峨': 'E',
};

// 标点符号和空白字符 -> 视为停顿（CLOSED）
const PAUSE_CHARS = new Set([
  '，', '。', '！', '？', '、', '；', '：',
  ',', '.', '!', '?', ';', ':',
  ' ', '\t', '\n', '\r',
  '（', '）', '(', ')', '「', '」', '"', '\'',
  '—', '…', '·',
]);

// Viseme 形状定义（相对基线的偏移量）
// lipWidth: 嘴唇宽度倍数（scaleX）
// lipHeight: 嘴唇厚度倍数（scaleY）
// jawOpen: 下颌张开角度（弧度）
export const VISIME_SHAPES = {
  CLOSED: { lipWidth: 0.80, lipHeight: 0.25, jawOpen: 0.00, tension: 0.0 },
  A:      { lipWidth: 1.80, lipHeight: 1.00, jawOpen: 0.65, tension: 0.0 },  // 啊：宽圆大嘴
  I:      { lipWidth: 2.00, lipHeight: 0.35, jawOpen: 0.15, tension: 0.0 },  // 衣：宽扁嘴
  U:      { lipWidth: 0.50, lipHeight: 0.80, jawOpen: 0.25, tension: 0.0 },  // 乌：窄圆嘴
  E:      { lipWidth: 1.30, lipHeight: 0.50, jawOpen: 0.35, tension: 0.0 },  // 厄：中等嘴
};

const VISEME_TRANSITION_DURATION = 0.06;
const PAUSE_DURATION = 0.12;

function charToViseme(char) {
  if (PAUSE_CHARS.has(char)) return 'CLOSED';
  return CHAR_TO_VISEME[char] || 'E';
}

export function generateVisemeSequence(text, startTime, duration) {
  if (!text || duration <= 0) return [];

  const chars = Array.from(text.trim());
  const segments = [];
  let currentViseme = null;
  let segmentStart = 0;

  for (let i = 0; i < chars.length; i++) {
    const viseme = charToViseme(chars[i]);
    if (viseme !== currentViseme) {
      if (currentViseme !== null) {
        segments.push({ viseme: currentViseme, length: i - segmentStart });
      }
      currentViseme = viseme;
      segmentStart = i;
    }
  }
  if (currentViseme !== null) {
    segments.push({ viseme: currentViseme, length: chars.length - segmentStart });
  }

  if (segments.length === 0) return [];

  const totalChars = chars.length;
  const pauseCount = chars.filter(c => PAUSE_CHARS.has(c)).length;
  const speechCount = totalChars - pauseCount;

  if (speechCount === 0) return [];

  const totalTransitionTime = Math.max(0, (segments.length - 1) * VISEME_TRANSITION_DURATION);
  const totalPauseExtra = pauseCount * PAUSE_DURATION;
  const availableTime = Math.max(0, duration - totalTransitionTime - totalPauseExtra);
  const timePerChar = availableTime / speechCount;

  const sequence = [];
  let currentTime = startTime;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segDuration = seg.viseme === 'CLOSED'
      ? seg.length * (timePerChar + PAUSE_DURATION)
      : seg.length * timePerChar;

    sequence.push({
      viseme: seg.viseme,
      startTime: currentTime,
      endTime: currentTime + segDuration,
    });

    currentTime += segDuration;
    if (i < segments.length - 1) {
      currentTime += VISEME_TRANSITION_DURATION;
    }
  }

  return sequence;
}

export function getVisemeAtTime(sequence, time) {
  if (!sequence || sequence.length === 0) {
    return { viseme: 'CLOSED', blend: 0, nextViseme: null };
  }

  if (time < sequence[0].startTime) {
    return { viseme: 'CLOSED', blend: 0, nextViseme: null };
  }

  const last = sequence[sequence.length - 1];
  if (time >= last.endTime) {
    return { viseme: 'CLOSED', blend: 0, nextViseme: null };
  }

  for (let i = 0; i < sequence.length; i++) {
    const seg = sequence[i];
    const nextSeg = sequence[i + 1];

    if (time >= seg.startTime && time < seg.endTime) {
      if (nextSeg && time >= seg.endTime - VISEME_TRANSITION_DURATION) {
        const transitionStart = seg.endTime - VISEME_TRANSITION_DURATION;
        const blend = (time - transitionStart) / VISEME_TRANSITION_DURATION;
        return {
          viseme: seg.viseme,
          blend: Math.min(1, Math.max(0, blend)),
          nextViseme: nextSeg.viseme,
        };
      }
      return { viseme: seg.viseme, blend: 0, nextViseme: null };
    }

    if (nextSeg && time >= seg.endTime && time < nextSeg.startTime) {
      const blend = (time - seg.endTime) / VISEME_TRANSITION_DURATION;
      return {
        viseme: seg.viseme,
        blend: Math.min(1, Math.max(0, blend)),
        nextViseme: nextSeg.viseme,
      };
    }
  }

  return { viseme: 'CLOSED', blend: 0, nextViseme: null };
}

export function lerpVisemeShapes(visemeA, visemeB, t) {
  const shapeA = VISIME_SHAPES[visemeA] || VISIME_SHAPES.CLOSED;
  const shapeB = VISIME_SHAPES[visemeB] || VISIME_SHAPES.CLOSED;

  return {
    lipHeight: shapeA.lipHeight + (shapeB.lipHeight - shapeA.lipHeight) * t,
    lipWidth: shapeA.lipWidth + (shapeB.lipWidth - shapeA.lipWidth) * t,
    jawOpen: shapeA.jawOpen + (shapeB.jawOpen - shapeA.jawOpen) * t,
    tension: shapeA.tension + (shapeB.tension - shapeA.tension) * t,
  };
}

export function getMouthShape(text, startTime, duration, currentTime) {
  const sequence = generateVisemeSequence(text, startTime, duration);
  return getMouthShapeFromSequence(sequence, currentTime);
}

export function getMouthShapeFromSequence(sequence, currentTime) {
  const { viseme, blend, nextViseme } = getVisemeAtTime(sequence, currentTime);

  if (nextViseme && blend > 0) {
    return lerpVisemeShapes(viseme, nextViseme, blend);
  }
  return VISIME_SHAPES[viseme] || VISIME_SHAPES.CLOSED;
}

export default {
  generateVisemeSequence,
  getVisemeAtTime,
  lerpVisemeShapes,
  getMouthShape,
  getMouthShapeFromSequence,
  VISIME_SHAPES,
};
