package com.example.library;

import static com.example.library.LibraryStore.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class LibraryService {
    private final LibraryStore store;
    public LibraryService(LibraryStore store) { this.store = store; }

    public Map<String,Object> snapshot() {
        var c = store.get();
        var books = rows(c, "SELECT b.*, (SELECT COUNT(*) FROM borrow x WHERE x.bid=b.bid) AS borrow_count FROM book b ORDER BY b.bid");
        var readers = rows(c, "SELECT r.*,t.typename,t.max_quantity,t.max_days,(SELECT COUNT(*) FROM borrow x WHERE x.rid=r.rid AND x.returntime IS NULL) AS active_count FROM reader r LEFT JOIN readertype t ON t.typeno=r.typeno ORDER BY r.rid");
        var borrows = rows(c, "SELECT x.*,b.bname,r.rname,r.dept,t.typename,t.max_days FROM borrow x LEFT JOIN book b ON b.bid=x.bid LEFT JOIN reader r ON r.rid=x.rid LEFT JOIN readertype t ON t.typeno=r.typeno ORDER BY x.id DESC");
        for (var row : borrows) {
            if (row.get("borrowtime") != null && row.get("max_days") != null) {
                LocalDate date = LocalDate.parse(row.get("borrowtime").toString());
                LocalDate due = date.plusDays(((Number)row.get("max_days")).intValue());
                row.put("due_date", due.toString());
                row.put("overdue_days", row.get("returntime") == null ? Math.max(0, ChronoUnit.DAYS.between(due, today())) : 0);
            } else { row.put("overdue_days", 0); }
        }
        Map<String,Object> data = new LinkedHashMap<>();
        data.put("demo",c.demo()); data.put("source",c.label()); data.put("today",today().toString());
        data.put("books",books); data.put("readers",readers); data.put("borrows",borrows);
        data.put("types",rows(c,"SELECT * FROM readertype ORDER BY typeno"));
        return data;
    }

    private String text(Map<String,Object> body, String key, int max, boolean required) {
        Object value = body.get(key);
        String s = value == null ? "" : value.toString().trim();
        if ((required && s.isEmpty()) || s.length()>max) throw new IllegalArgumentException("请检查字段 " + key + "：" + (required ? "必填，" : "") + "最多 " + max + " 个字符");
        return s;
    }
    private int number(Map<String,Object> body, String key) {
        try { int value = Integer.parseInt(String.valueOf(body.get(key))); if(value<0) throw new NumberFormatException(); return value; }
        catch(Exception ex) { throw new IllegalArgumentException(key + " 必须是非负整数"); }
    }

    public void saveBook(String id, Map<String,Object> body) {
        String bid = text(body,"bid",20,true), name = text(body,"bname",50,true);
        String author=text(body,"author",30,false), publisher=text(body,"publisher",30,false), position=text(body,"position",20,false);
        BigDecimal price;
        try { price=new BigDecimal(String.valueOf(body.get("price"))).setScale(2,java.math.RoundingMode.UNNECESSARY); if(price.signum()<=0 || price.precision()>10) throw new NumberFormatException(); }
        catch(Exception ex) { throw new IllegalArgumentException("定价必须大于 0，最多保留两位小数，且不超过 99999999.99"); }
        String dateText=text(body,"publishdate",10,false);
        LocalDate date=dateText.isEmpty()? null:LocalDate.parse(dateText);
        int total=number(body,"total"); var c=store.get();
        if(id==null) c.jdbc().update("INSERT INTO book(bid,bname,author,publisher,publishdate,price,total,position) VALUES(?,?,?,?,?,?,?,?)",bid,name,author,publisher,date,price,total,position);
        else {
            if(!id.equals(bid)) throw new IllegalArgumentException("图书编号不能修改");
            if(c.jdbc().update("UPDATE book SET bname=?,author=?,publisher=?,publishdate=?,price=?,total=?,position=? WHERE bid=?",name,author,publisher,date,price,total,position,id)!=1) throw new IllegalArgumentException("图书不存在");
        }
    }

    public void saveReader(String id, Map<String,Object> body) {
        String rid=text(body,"rid",20,true),name=text(body,"rname",20,true),sex=text(body,"sex",2,true),dept=text(body,"dept",40,false),tel=text(body,"tel",20,false);
        if(!List.of("男","女").contains(sex)) throw new IllegalArgumentException("请选择性别");
        int type=number(body,"typeno"); var c=store.get();
        c.tx().executeWithoutResult(status -> {
            if(id!=null) one(c,"SELECT rid FROM reader WHERE rid=? FOR UPDATE",id);
            if(count(c,"SELECT COUNT(*) FROM readertype WHERE typeno=?",type)==0) throw new IllegalArgumentException("读者类别不存在");
            if(id==null) c.jdbc().update("INSERT INTO reader(rid,rname,sex,typeno,dept,tel) VALUES(?,?,?,?,?,?)",rid,name,sex,type,dept,tel);
            else {
                if(!id.equals(rid)) throw new IllegalArgumentException("读者编号不能修改");
                c.jdbc().update("UPDATE reader SET rname=?,sex=?,typeno=?,dept=?,tel=? WHERE rid=?",name,sex,type,dept,tel,id);
            }
        });
    }

    public void deleteBook(String id) {
        var c=store.get(); c.tx().executeWithoutResult(status -> {
            one(c,"SELECT bid FROM book WHERE bid=? FOR UPDATE",id);
            if(count(c,"SELECT COUNT(*) FROM borrow WHERE bid=?",id)>0) throw new IllegalArgumentException("这本书已有借阅历史，为保留记录，不能删除");
            c.jdbc().update("DELETE FROM book WHERE bid=?",id);
        });
    }
    public void deleteReader(String id) {
        var c=store.get(); c.tx().executeWithoutResult(status -> {
            one(c,"SELECT rid FROM reader WHERE rid=? FOR UPDATE",id);
            if(count(c,"SELECT COUNT(*) FROM borrow WHERE rid=?",id)>0) throw new IllegalArgumentException("这位读者已有借阅历史，不能删除");
            c.jdbc().update("DELETE FROM reader WHERE rid=?",id);
        });
    }

    private int stock(Context c,String bid) {
        Object value=one(c,"SELECT total FROM book WHERE bid=? FOR UPDATE",bid).get("total");
        if(!(value instanceof Number)) throw new IllegalArgumentException("图书库存为空，请先维护库存");
        return ((Number)value).intValue();
    }
    private void reconcileStock(Context c,String bid,int before,int delta) {
        int after=stock(c,bid);
        // Existing course triggers may already adjust inventory. Never apply the same change twice.
        if(after==before) c.jdbc().update("UPDATE book SET total=? WHERE bid=?",before+delta,bid);
        else if(after!=before+delta) throw new IllegalArgumentException("数据库触发器产生了异常库存变化，本次操作已回滚，请检查触发器");
    }

    public void borrow(Map<String,Object> body) {
        String rid=text(body,"rid",20,true),bid=text(body,"bid",20,true); var c=store.get();
        c.tx().executeWithoutResult(status -> {
            one(c,"SELECT bid FROM book WHERE bid=? FOR UPDATE",bid);
            one(c,"SELECT rid FROM reader WHERE rid=? FOR UPDATE",rid);
            int before=stock(c,bid);
            if(before<=0) throw new IllegalArgumentException("库存不足，暂时无法借阅");
            var type=one(c,"SELECT t.max_quantity,t.max_days FROM reader r JOIN readertype t ON t.typeno=r.typeno WHERE r.rid=?",rid);
            if(!(type.get("max_quantity") instanceof Number limit) || !(type.get("max_days") instanceof Number days) || days.intValue()<=0) throw new IllegalArgumentException("读者类别的借阅规则不完整，请先在数据库中完善");
            if(count(c,"SELECT COUNT(*) FROM borrow WHERE rid=? AND returntime IS NULL",rid)>=limit.intValue()) throw new IllegalArgumentException("该读者已达到最大可借数量");
            if(count(c,"SELECT COUNT(*) FROM borrow WHERE rid=? AND bid=? AND returntime IS NULL",rid,bid)>0) throw new IllegalArgumentException("这位读者已借阅此书，请先归还");
            c.jdbc().update("INSERT INTO borrow(rid,bid,borrowtime,returntime) VALUES(?,?,?,NULL)",rid,bid,today());
            reconcileStock(c,bid,before,-1);
        });
    }

    public void returnBook(int id) {
        var c=store.get();
        c.tx().executeWithoutResult(status -> {
            var initial=one(c,"SELECT rid,bid FROM borrow WHERE id=?",id);
            String bid=String.valueOf(initial.get("bid")),rid=String.valueOf(initial.get("rid"));
            one(c,"SELECT bid FROM book WHERE bid=? FOR UPDATE",bid);
            one(c,"SELECT rid FROM reader WHERE rid=? FOR UPDATE",rid);
            var record=one(c,"SELECT * FROM borrow WHERE id=? FOR UPDATE",id);
            if(record.get("returntime")!=null) throw new IllegalArgumentException("这条借阅记录已经归还，请勿重复操作");
            if(record.get("borrowtime")==null || LocalDate.parse(record.get("borrowtime").toString()).isAfter(today())) throw new IllegalArgumentException("借阅日期异常，无法登记归还");
            int before=stock(c,bid);
            c.jdbc().update("UPDATE borrow SET returntime=? WHERE id=? AND returntime IS NULL",today(),id);
            reconcileStock(c,bid,before,1);
        });
    }
}
