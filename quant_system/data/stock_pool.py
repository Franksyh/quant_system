stock_pool = set()

def add_stock(symbol):
    stock_pool.add(symbol)

def remove_stock(symbol):
    stock_pool.discard(symbol)

def get_all():
    return list(stock_pool)
