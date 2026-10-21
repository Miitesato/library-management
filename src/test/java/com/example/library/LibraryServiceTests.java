package com.example.library;

import static org.junit.jupiter.api.Assertions.*;
import static com.example.library.LibraryStore.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class LibraryServiceTests {
    LibraryStore store;
    LibraryService service;
    @BeforeEach void setup() {
        store=new LibraryStore(new DriverManagerDataSource("jdbc:h2:mem:test_"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1;LOCK_TIMEOUT=10000","sa",""));
        service=new LibraryService(store);
    }
    private long stock(String bid) {return count(store.get(),"SELECT total FROM book WHERE bid=?",bid);}
    private int newestId() {return (int)count(store.get(),"SELECT MAX(id) FROM borrow");}

    @Test void borrowAndReturnAdjustInventoryExactlyOnce() {
        long before=stock("00551060");
        service.borrow(Map.of("rid","10100391","bid","00551060"));
        int id=newestId();
        assertEquals(before-1,stock("00551060"));
        service.returnBook(id);
        assertEquals(before,stock("00551060"));
        assertThrows(IllegalArgumentException.class,()->service.returnBook(id));
        assertEquals(before,stock("00551060"));
    }
    @Test void duplicateBorrowAndNoStockDoNotCreateRecords() {
        long before=count(store.get(),"SELECT COUNT(*) FROM borrow");
        assertThrows(IllegalArgumentException.class,()->service.borrow(Map.of("rid","10100391","bid","01331088")));
        store.get().jdbc().update("UPDATE book SET total=0 WHERE bid='00551060'");
        assertThrows(IllegalArgumentException.class,()->service.borrow(Map.of("rid","10100391","bid","00551060")));
        assertEquals(before,count(store.get(),"SELECT COUNT(*) FROM borrow"));
        assertEquals(0,stock("00551060"));
    }
    @Test void maximumBorrowQuantityIsEnforced() {
        store.get().jdbc().update("UPDATE readertype SET max_quantity=1 WHERE typeno=1");
        long before=stock("00551060");
        assertThrows(IllegalArgumentException.class,()->service.borrow(Map.of("rid","10100391","bid","00551060")));
        assertEquals(before,stock("00551060"));
    }
    @Test void readerAndBookWithHistoryCannotBeDeleted() {
        assertThrows(IllegalArgumentException.class,()->service.deleteBook("00539040"));
        assertThrows(IllegalArgumentException.class,()->service.deleteReader("10100391"));
        assertEquals(1,count(store.get(),"SELECT COUNT(*) FROM book WHERE bid='00539040'"));
    }
    @Test void concurrentBorrowOfLastCopySucceedsOnce() throws Exception {
        store.get().jdbc().update("UPDATE book SET total=1 WHERE bid='00551060'");
        long before=count(store.get(),"SELECT COUNT(*) FROM borrow");
        var gate=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            List<Future<Boolean>> futures=new ArrayList<>();
            for(String rid:List.of("10100391","10501561")) futures.add(pool.submit(()->{
                gate.await();try {service.borrow(Map.of("rid",rid,"bid","00551060"));return true;}
                catch(IllegalArgumentException ex){return false;}
            }));
            gate.countDown();
            int successes=0;for(var f:futures)if(f.get(15,TimeUnit.SECONDS))successes++;
            assertEquals(1,successes);
        }
        assertEquals(0,stock("00551060"));
        assertEquals(before+1,count(store.get(),"SELECT COUNT(*) FROM borrow"));
    }
    @Test void existingReturnTriggerDoesNotDoubleIncrementStock() {
        store.get().jdbc().execute("CREATE TRIGGER course_return AFTER UPDATE ON borrow FOR EACH ROW CALL 'com.example.library.LibraryServiceTests$ReturnTrigger'");
        long before=stock("01331088");
        int id=store.get().jdbc().queryForObject("SELECT id FROM borrow WHERE rid='10100391' AND bid='01331088'",Integer.class);
        service.returnBook(id);
        assertEquals(before+1,stock("01331088"));
    }
    @Test void unexpectedTriggerRollsBackBothInventoryAndReturn() {
        store.get().jdbc().execute("CREATE TRIGGER broken_return AFTER UPDATE ON borrow FOR EACH ROW CALL 'com.example.library.LibraryServiceTests$BadReturnTrigger'");
        long before=stock("01331088");
        int id=store.get().jdbc().queryForObject("SELECT id FROM borrow WHERE rid='10100391' AND bid='01331088'",Integer.class);
        assertThrows(IllegalArgumentException.class,()->service.returnBook(id));
        assertEquals(before,stock("01331088"));
        assertNull(one(store.get(),"SELECT returntime FROM borrow WHERE id=?",id).get("returntime"));
    }
    @Test void newBookPreservesLeadingZeroAndCanBeDeletedWithoutHistory() {
        service.saveBook(null,Map.of("bid","00000001","bname","测试图书","price","18.50","total",2));
        assertEquals("00000001",one(store.get(),"SELECT * FROM book WHERE bid='00000001'").get("bid"));
        service.deleteBook("00000001");
        assertEquals(0,count(store.get(),"SELECT COUNT(*) FROM book WHERE bid='00000001'"));
    }
    @Test void readerCanBeCreatedEditedAndDeleted() {
        service.saveReader(null,Map.of("rid","TEST_READER","rname","测试读者","sex","女","typeno","2","dept","测试学院","tel","12345678"));
        assertEquals("测试读者",one(store.get(),"SELECT * FROM reader WHERE rid='TEST_READER'").get("rname"));
        service.saveReader("TEST_READER",Map.of("rid","TEST_READER","rname","修改姓名","sex","男","typeno","1","dept","另一学院","tel",""));
        assertEquals("修改姓名",one(store.get(),"SELECT * FROM reader WHERE rid='TEST_READER'").get("rname"));
        service.deleteReader("TEST_READER");
        assertEquals(0,count(store.get(),"SELECT COUNT(*) FROM reader WHERE rid='TEST_READER'"));
    }
    @Test void invalidRulesAndInvalidPriceAreRejected() {
        assertThrows(IllegalArgumentException.class,()->service.saveBook(null,Map.of("bid","bad","bname","坏数据","price","-1","total",1)));
        store.get().jdbc().update("UPDATE readertype SET max_days=NULL WHERE typeno=1");
        assertThrows(IllegalArgumentException.class,()->service.borrow(Map.of("rid","10100391","bid","00551060")));
    }
    public static class ReturnTrigger implements org.h2.api.Trigger {
        @Override public void fire(Connection connection,Object[] oldRow,Object[] newRow) throws SQLException {update(connection,oldRow,newRow,1);}
        static void update(Connection c,Object[] oldRow,Object[] newRow,int delta) throws SQLException {
            if(oldRow[4]==null&&newRow[4]!=null)try(var ps=c.prepareStatement("UPDATE book SET total=total+? WHERE bid=?")){ps.setInt(1,delta);ps.setObject(2,newRow[2]);ps.executeUpdate();}
        }
    }
    public static class BadReturnTrigger implements org.h2.api.Trigger {
        @Override public void fire(Connection c,Object[] oldRow,Object[] newRow) throws SQLException {ReturnTrigger.update(c,oldRow,newRow,2);}
    }
}
